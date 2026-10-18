import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { getPhoneOffer, sellPhoneOffer, type PhoneOfferSaleInput } from "../../src/lib/phone-offers";

// The phone offer read touches the photo store, as the phone-offers test does.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-phone-offer-sale-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Selling an offer from the phone (#2009): a new sale to the buyer at the price, dated today, on the
// offer's platform — the desk's *Sell* in one act. One set at a time (decided with the collector on
// 2026-10-17): the first set left, flagged *picked, not chosen* (#697) while others were left too. The
// offer goes *Sold* with its last set, as at the desk, and a refused sale leaves nothing behind.

describe("selling an offer from the phone (#2009)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let facebookId: string;
  let groupId: string;
  let stampId: string;
  let conditionId: string;
  const today = new Date().toISOString().slice(0, 10);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phone-sell-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-sell-${ts}`, name: "Phone sell", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Fair", platformCurrency: "EUR" } })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki",
        url: "https://www.facebook.com/groups/2009",
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    // Sales first: a sold copy is `Restrict`-ed by its sale line, and a buyer by the sale.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  const copy = async () =>
    (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  /** An offer that is up, at quantity `n`: `n` single-copy sets. */
  async function liveOffer(n: number, on: "fair" | "facebook" = "fair"): Promise<{ offerId: string; setIds: string[] }> {
    const offerId = await createOffer(userId, collectionId, {
      platformId: on === "fair" ? platformId : facebookId,
      url: null,
      price: "5.00",
      currency: on === "fair" ? "EUR" : "PLN",
      listingDate: null,
      state: "preparing",
      // A quick buy — the case #2009 names; an auction would want a starting price to go up.
      ...(on === "facebook" ? { facebookGroupId: groupId, listingType: "fixed" as const } : {}),
    });
    const setIds: string[] = [];
    for (let i = 0; i < n; i++) setIds.push(await addOfferSet(userId, offerId, [await copy()]));
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return { offerId, setIds };
  }

  const buyer = (over: Partial<PhoneOfferSaleInput> = {}): PhoneOfferSaleInput => ({
    buyerId: "",
    buyerName: "",
    buyerFacebookProfileUrl: "",
    price: "5.00",
    ...over,
  });

  async function sold(saleId: string) {
    return prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        status: true,
        platformId: true,
        currency: true,
        soldAt: true,
        buyer: { select: { id: true, name: true, facebookProfiles: { select: { url: true } } } },
        lines: { select: { offerId: true, offerSetId: true, price: true, setChoicePending: true } },
      },
    });
  }

  it("records a new sale to a new buyer at the price, one set picked rather than chosen", async () => {
    const { offerId, setIds } = await liveOffer(2);
    assert.equal((await getPhoneOffer(userId, collectionId, offerId))?.setsLeft, 2);

    const result = await sellPhoneOffer(userId, collectionId, offerId, buyer({ buyerName: "Jan at the fair", price: "4,50" }), today);
    assert.ok(result.ok);
    const sale = await sold(result.saleId);
    assert.equal(sale.status, "ordered");
    assert.equal(sale.platformId, platformId);
    assert.equal(sale.currency, "EUR");
    assert.equal(sale.soldAt.toISOString().slice(0, 10), today);
    assert.equal(sale.buyer?.name, "Jan at the fair");
    assert.equal(sale.lines.length, 1);
    assert.equal(sale.lines[0].offerSetId, setIds[0]);
    assert.equal(sale.lines[0].price.toFixed(2), "4.50");
    assert.equal(sale.lines[0].setChoicePending, true);

    const after = await getPhoneOffer(userId, collectionId, offerId);
    assert.equal(after?.state, "active");
    assert.equal(after?.setsLeft, 1);
  });

  it("sells the last set to an existing buyer as a chosen line, and the offer goes sold", async () => {
    const { offerId, setIds } = await liveOffer(2);
    const first = await sellPhoneOffer(userId, collectionId, offerId, buyer({ buyerName: "Repeat buyer" }), today);
    assert.ok(first.ok);
    const known = (await sold(first.saleId)).buyer!;

    const second = await sellPhoneOffer(
      userId,
      collectionId,
      offerId,
      buyer({ buyerId: known.id, buyerName: known.name }),
      today
    );
    assert.ok(second.ok);
    const sale = await sold(second.saleId);
    assert.equal(sale.buyer?.id, known.id);
    assert.equal(sale.lines[0].offerSetId, setIds[1]);
    assert.equal(sale.lines[0].setChoicePending, false);

    const offer = await getPhoneOffer(userId, collectionId, offerId);
    assert.equal(offer?.state, "sold");
    assert.equal(offer?.setsLeft, 0);
    const again = await sellPhoneOffer(userId, collectionId, offerId, buyer(), today);
    assert.deepEqual(again, { ok: false, message: "Nothing left to sell on this offer." });
  });

  it("allows a buyer unknown, as the desk does", async () => {
    const { offerId } = await liveOffer(1);
    const result = await sellPhoneOffer(userId, collectionId, offerId, buyer(), today);
    assert.ok(result.ok);
    assert.equal((await sold(result.saleId)).buyer, null);
  });

  it("names a Facebook offer's buyer by their profile, in the offer's currency", async () => {
    const { offerId } = await liveOffer(1, "facebook");
    assert.equal((await getPhoneOffer(userId, collectionId, offerId))?.buyerByFacebookProfile, true);
    const result = await sellPhoneOffer(
      userId,
      collectionId,
      offerId,
      buyer({ buyerName: "Ola Kot", buyerFacebookProfileUrl: "https://m.facebook.com/ola.kot/" }),
      today
    );
    assert.ok(result.ok);
    const sale = await sold(result.saleId);
    assert.equal(sale.currency, "PLN");
    assert.equal(sale.buyer?.name, "Ola Kot");
    assert.deepEqual(sale.buyer?.facebookProfiles.map((p) => p.url), ["https://www.facebook.com/ola.kot"]);
  });

  it("refuses a price it cannot read and records nothing", async () => {
    const { offerId } = await liveOffer(1);
    const before = await prisma.sale.count({ where: { collectionId } });
    const result = await sellPhoneOffer(userId, collectionId, offerId, buyer({ price: "" }), today);
    assert.deepEqual(result, { ok: false, message: "Enter a sale price." });
    assert.equal(await prisma.sale.count({ where: { collectionId } }), before);
    assert.equal((await getPhoneOffer(userId, collectionId, offerId))?.setsLeft, 1);
  });

  it("does not sell an offer that is not up, nor someone else's", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [await copy()]);
    assert.equal((await getPhoneOffer(userId, collectionId, offerId))?.setsLeft, 0);
    assert.equal((await sellPhoneOffer(userId, collectionId, offerId, buyer(), today)).ok, false);

    const { offerId: live } = await liveOffer(1);
    await assert.rejects(() => sellPhoneOffer("someone-else", collectionId, live, buyer(), today));
  });
});
