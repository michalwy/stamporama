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

const URL_ONE = "https://colnect.com/en/market/sale/h5UXNh";
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
      select: { state: true, url: true, listingDate: true },
    });

  it("takes a ready offer live with the URL and today's listing date", async () => {
    const offerId = await readyOffer();
    assert.equal(await recordOfferListed(userId, offerId, URL_ONE), "activated");

    const row = await offerRow(offerId);
    assert.equal(row.state, "active");
    assert.equal(row.url, URL_ONE);
    assert.deepEqual(row.listingDate, today());
  });

  it("is a no-op the second time — the two deliverers must not collide", async () => {
    const offerId = await readyOffer();
    await recordOfferListed(userId, offerId, URL_ONE);

    // The other deliverer arrives with the same URL: nothing to do, and nothing refused.
    assert.equal(await recordOfferListed(userId, offerId, URL_ONE), "unchanged");
    // And a *different* URL does not overwrite a record that already carries one: whatever is there
    // was put there by the collector or by this same capture.
    assert.equal(await recordOfferListed(userId, offerId, URL_TWO), "unchanged");
    assert.equal((await offerRow(offerId)).url, URL_ONE);
  });

  it("fills a blank URL on an offer that is already active", async () => {
    const offerId = await readyOffer();
    await setOfferState(userId, offerId, "active"); // activated by hand, no URL to hand over yet
    assert.equal((await offerRow(offerId)).url, null);

    assert.equal(await recordOfferListed(userId, offerId, URL_ONE), "url-recorded");
    const row = await offerRow(offerId);
    assert.equal(row.url, URL_ONE);
    assert.equal(row.state, "active");
  });

  it("refuses an offer no marketplace submission may take live", async () => {
    const offerId = await readyOffer();
    await setOfferState(userId, offerId, "preparing");
    await assert.rejects(
      () => recordOfferListed(userId, offerId, URL_ONE),
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
});
