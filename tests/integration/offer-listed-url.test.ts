import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  OfferActionBlockedError,
  recordOfferListed,
  setOfferState,
} from "../../src/lib/offers";

// Recording the URL a submitted listing came back with (#412). The write-back has **two** deliverers
// by design — the page that handed the offer over publishes it, and the extension posts it when no
// page took the answer — so the one property that has to hold is idempotence: arriving twice, in
// either order, must be a no-op and never a refusal.

/** Today at UTC midnight — the shape `Offer.listingDate` (`@db.Date`) stores. */
function today(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

// One code per *offer*, not one per file: since #696 the sale code inside a Colnect listing URL is
// stored on `Offer.colnectSaleId` and is unique per collection, so two offers of this collection
// cannot both claim `h5UXNh` — which is the point of the column. Each case takes its own address.
let nextCode = 0;
const saleUrl = () => `https://colnect.com/en/market/sale/h5UX${nextCode++}`;
const URL_TWO = "https://colnect.com/en/market/sale/other1";

describe("recording a listing's URL (#412)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-listedurl-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User listedurl-${ts}`,
        email: `test-listedurl-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-listedurl-${ts}`,
        name: `Collection listedurl-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp U" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** A `ready` offer with one set — what the Assistant hands over. */
  async function readyOffer(): Promise<string> {
    const itemId = (
      await createItem(userId, collectionId, { stampId, conditionId, forSale: true })
    ).id;
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [itemId]);
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  const offerRow = (offerId: string) =>
    prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, url: true, listingDate: true, colnectSaleId: true },
    });

  it("takes a ready offer live with the URL and today's listing date", async () => {
    const offerId = await readyOffer();
    const url = saleUrl();
    assert.equal(await recordOfferListed(userId, offerId, url), "activated");

    const row = await offerRow(offerId);
    assert.equal(row.state, "active");
    assert.equal(row.url, url);
    assert.deepEqual(row.listingDate, today());
    // The address a person clicks and the id the app joins on are written together (#696).
    assert.equal(row.colnectSaleId, url.slice(url.lastIndexOf("/") + 1));
  });

  it("is a no-op the second time — the two deliverers must not collide", async () => {
    const offerId = await readyOffer();
    const url = saleUrl();
    await recordOfferListed(userId, offerId, url);

    // The other deliverer arrives with the same URL: nothing to do, and nothing refused.
    assert.equal(await recordOfferListed(userId, offerId, url), "unchanged");
    // And a *different* URL does not overwrite a record that already carries one: whatever is there
    // was put there by the collector or by this same capture.
    assert.equal(await recordOfferListed(userId, offerId, URL_TWO), "unchanged");
    assert.equal((await offerRow(offerId)).url, url);
  });

  it("fills a blank URL on an offer that is already active", async () => {
    const offerId = await readyOffer();
    await setOfferState(userId, offerId, "active"); // activated by hand, no URL to hand over yet
    assert.equal((await offerRow(offerId)).url, null);

    const url = saleUrl();
    assert.equal(await recordOfferListed(userId, offerId, url), "url-recorded");
    const row = await offerRow(offerId);
    assert.equal(row.url, url);
    assert.equal(row.state, "active");
    assert.equal(row.colnectSaleId, url.slice(url.lastIndexOf("/") + 1));
  });

  it("refuses an offer no marketplace submission may take live", async () => {
    const offerId = await readyOffer();
    await setOfferState(userId, offerId, "preparing");
    await assert.rejects(
      () => recordOfferListed(userId, offerId, saleUrl()),
      (e: unknown) =>
        e instanceof OfferActionBlockedError && e.reason === "bad-transition"
    );
    assert.equal((await offerRow(offerId)).url, null);
  });

  it("refuses a blank URL — the URL is the record", async () => {
    const offerId = await readyOffer();
    await assert.rejects(
      () => recordOfferListed(userId, offerId, "   "),
      (e: unknown) => e instanceof OfferActionBlockedError && e.reason === "no-url"
    );
    assert.equal((await offerRow(offerId)).state, "ready");
  });

  // #696: one live listing belongs to one offer. The capture is where a second claim on one sale
  // code would otherwise be made silently — the collector posted the wrong offer, or recorded the
  // address on the wrong one — and the refusal names the offer that already holds it.
  it("refuses a second offer claiming a Colnect listing another one already is", async () => {
    const first = await readyOffer();
    const url = saleUrl();
    await recordOfferListed(userId, first, url);

    const second = await readyOffer();
    await assert.rejects(
      () => recordOfferListed(userId, second, url),
      (e: unknown) => e instanceof OfferActionBlockedError && e.reason === "duplicate-listing"
    );
    // Refused *before* the transition, so the second offer is untouched — a live listing with no
    // address recorded on it is the state the URL-after-transition order exists to prevent.
    const row = await offerRow(second);
    assert.equal(row.state, "ready");
    assert.equal(row.url, null);
  });
});
