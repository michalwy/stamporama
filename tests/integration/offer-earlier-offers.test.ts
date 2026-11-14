import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, getOfferDetail, setOfferState } from "../../src/lib/offers";
import { addSaleLines, createSale, listSellableOffers, type SaleHeaderInput } from "../../src/lib/sales";
import { offerDetail } from "../../src/lib/agent-api/offer-reads";

// An offer shows what the same stamps were offered and sold for before (#2521): the price table's two
// Last sale rows (this platform, any platform) and the Earlier offers tab's rows, read by
// `getOfferDetail` — and `get_offer` carries both. The issue's own Done-when case: a series sold
// earlier on one platform and on another in the same condition, withdrawn once, and once offered in
// another condition.

const ts = Date.now();

describe("An offer's earlier offers (#2521)", () => {
  let userId: string;
  let collectionId: string;
  let mnhId: string;
  let usedId: string;
  let colnectId: string;
  let facebookId: string;
  const series: string[] = [];

  async function stamp(name: string): Promise<string> {
    return (await prisma.stamp.create({ data: { collectionId, name, issuedYear: 1960 } })).id;
  }

  /** A fresh copy of each of `stampIds`, in `conditionId`. */
  async function copies(stampIds: readonly string[], conditionId = mnhId): Promise<string[]> {
    const ids: string[] = [];
    for (const stampId of stampIds) {
      ids.push((await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id);
    }
    return ids;
  }

  /** An offer of one set holding `itemIds`, listed at `price`, moved on to `state`. */
  async function offer(
    platformId: string,
    itemIds: string[],
    price: string,
    state: "preparing" | "active" | "withdrawn",
    listingDate: string | null = null
  ): Promise<string> {
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId, url: null, price, startingPrice: null, currency: "EUR", listingDate: null },
      { seedItemIds: itemIds, seedPerCopy: false }
    );
    if (state !== "preparing") {
      await setOfferState(userId, offerId, "ready");
      await setOfferState(userId, offerId, "active");
    }
    if (state === "withdrawn") await setOfferState(userId, offerId, "withdrawn");
    // Going live stamps today as the listing date; these went up on the day given.
    if (listingDate) await prisma.offer.update({ where: { id: offerId }, data: { listingDate: new Date(listingDate) } });
    return offerId;
  }

  /** Sells the offer's one set on `platformId` at `price`, on `soldAt`. */
  async function sell(offerId: string, platformId: string, price: string, soldAt: string): Promise<void> {
    const header: SaleHeaderInput = {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(soldAt),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    };
    const saleId = await createSale(userId, collectionId, header);
    const [sellable] = await listSellableOffers(userId, collectionId, { offerId });
    await addSaleLines(
      userId,
      saleId,
      sellable!.sets.map((s) => ({ offerId, offerSetId: s.offerSetId, price, itemIds: s.itemIds }))
    );
  }

  before(async () => {
    userId = `test-user-earlier-offers-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test User",
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-earlier-offers-${ts}`, name: "Earlier offers", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    mnhId = (await prisma.stampCondition.create({ data: { collectionId, name: "MNH", abbreviation: "**", sortOrder: 0 } })).id;
    usedId = (await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "o", sortOrder: 1 } })).id;
    colnectId = (await prisma.platform.create({ data: { collectionId, name: "Colnect", platformCurrency: "EUR" } })).id;
    facebookId = (await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "EUR" } })).id;
    for (const name of ["Mi 1", "Mi 2", "Mi 3"]) series.push(await stamp(name));
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("gives both Last sale rows and the earlier offers, newest first, for a series sold before here and elsewhere", async () => {
    const soldHere = await offer(colnectId, await copies(series), "15.00", "active", "2026-07-01");
    await sell(soldHere, colnectId, "12.00", "2026-08-01");
    const soldElsewhere = await offer(facebookId, await copies(series), "30.00", "active", "2026-09-01");
    await sell(soldElsewhere, facebookId, "25.00", "2026-10-03");
    const withdrawn = await offer(colnectId, await copies(series), "18.00", "withdrawn", "2026-05-01");
    const otherCondition = await offer(colnectId, await copies(series, usedId), "6.00", "withdrawn", "2026-04-01");
    // Part of the series, and an offer still being prepared, are not earlier offers of it.
    const part = await offer(colnectId, await copies(series.slice(0, 2)), "9.00", "withdrawn", "2026-03-01");
    const preparing = await offer(colnectId, await copies(series), "11.00", "preparing");

    const current = await offer(colnectId, await copies(series), "0.00", "preparing");
    const detail = (await getOfferDetail(userId, current))!;
    const earlier = detail.earlierOffers;

    assert.equal(earlier.lastSale.platform?.amount, "12.00");
    assert.equal(earlier.lastSale.platform?.sources[0].offerId, soldHere);
    assert.equal(earlier.lastSale.any?.amount, "25.00");
    assert.equal(earlier.lastSale.any?.sources[0].platformName, "Facebook");

    assert.deepEqual(
      earlier.rows.map((r) => r.offerId),
      [soldElsewhere, soldHere, withdrawn, otherCondition]
    );
    const byOffer = new Map(earlier.rows.map((r) => [r.offerId, r]));
    assert.ok(!byOffer.has(part) && !byOffer.has(preparing) && !byOffer.has(current));
    assert.deepEqual(byOffer.get(soldHere)?.outcome.kind, "sold");
    assert.equal(byOffer.get(soldHere)?.listed, "15.00");
    assert.equal(byOffer.get(withdrawn)?.outcome.kind, "withdrawn");
    assert.equal(byOffer.get(otherCondition)?.sameCondition, false);
    assert.equal(byOffer.get(otherCondition)?.conditionLabel, "Used");

    // `get_offer` carries the same.
    const agent = offerDetail(detail, "/c/x/offers/y");
    assert.equal(agent.pricing.lastSale.platform?.amount, "12.00");
    assert.equal(agent.pricing.lastSale.anyPlatform?.platform, "Facebook");
    assert.equal(agent.pricing.lastSale.anyPlatform?.soldOn, "2026-10-03");
    assert.equal(agent.earlierOffers.length, 4);
    assert.equal(agent.earlierOffers[0].soldFor, "25.00");
  });

  it("has neither Last sale and no earlier offers for stamps never offered before", async () => {
    const fresh = await copies([await stamp("Mi 99")]);
    const current = await offer(colnectId, fresh, "0.00", "preparing");
    const earlier = (await getOfferDetail(userId, current))!.earlierOffers;
    assert.deepEqual(earlier.rows, []);
    assert.equal(earlier.lastSale.platform, null);
    assert.equal(earlier.lastSale.any, null);
  });
});
