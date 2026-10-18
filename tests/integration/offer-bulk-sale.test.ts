import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState } from "../../src/lib/offers";
import { createSale, addSaleLines, listSellableOffers, readSaleHeadline } from "../../src/lib/sales";
import { planOfferSale, saleTargetOf, type SaleCandidate } from "../../src/lib/offer-sale-plan";

// Several ticked offers sold into one sale (#2050): the dialog plans the lines off the sellable-offers
// read and writes them with one `addSaleLines`, so every set each offer had left lands on the sale at
// that offer's price, and an offer on another platform is named and left alone. The toast that follows
// names the sale by its number and buyer (#2049), read back with `readSaleHeadline`.

describe("selling several offers into one sale (#2050)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  const candidates: SaleCandidate[] = [];

  async function listedOffer(onPlatform: string, price: string, sets: number): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: `Stamp ${price}` } });
    const condition = await prisma.stampCondition.findFirstOrThrow({ where: { collectionId } });
    const offerId = await createOffer(userId, collectionId, {
      platformId: onPlatform,
      url: null,
      price,
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    for (let i = 0; i < sets; i++) {
      const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true });
      await addOfferSet(userId, offerId, [item.id]);
    }
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return offerId;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-bulk-sale-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User bulk-sale-${ts}`,
        email: `test-bulk-sale-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-bulk-sale-${ts}`, name: `Collection bulk-sale-${ts}`, baseCurrency: "PLN", ownerId: userId },
    });
    collectionId = col.id;
    await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } });
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Facebook" } })).id;
    otherPlatformId = (await prisma.platform.create({ data: { collectionId, name: "Colnect" } })).id;

    const prices: [string, string, number][] = [
      [platformId, "12.00", 2],
      [platformId, "7.50", 1],
      [otherPlatformId, "3.00", 1],
    ];
    for (const [onPlatform, price, sets] of prices) {
      const id = await listedOffer(onPlatform, price, sets);
      const offer = await prisma.offer.findUniqueOrThrow({ where: { id }, select: { offerNo: true } });
      candidates.push({
        id,
        offerNo: offer.offerNo,
        platformId: onPlatform,
        platformName: onPlatform === platformId ? "Facebook" : "Colnect",
        currency: "PLN",
        price,
      });
    }
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("puts every set the offers had left on one sale at each offer's price, and leaves the stray out", async () => {
    const target = saleTargetOf(candidates);
    assert.equal(target?.platformId, platformId);
    const sellable = await listSellableOffers(userId, collectionId, { platformId });
    const plan = planOfferSale(candidates, target, new Map(sellable.map((o) => [o.offerId, o.sets])));
    assert.deepEqual(plan.skipped.map((s) => [s.offer.offerNo, s.reason]), [
      [candidates[2].offerNo, "is on Colnect, not Facebook"],
    ]);

    const buyer = await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } });
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: buyer.id,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-10-18"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, plan.lines);

    const lines = await prisma.saleLine.findMany({ where: { saleId }, select: { offerId: true, price: true } });
    assert.deepEqual(
      lines.map((l) => [l.offerId, l.price.toFixed(2)]).sort(),
      [
        [candidates[0].id, "12.00"],
        [candidates[0].id, "12.00"],
        [candidates[1].id, "7.50"],
      ].sort()
    );
    assert.equal(
      await prisma.saleLine.count({ where: { offerId: candidates[2].id } }),
      0,
      "the offer on another platform is not sold"
    );

    const headline = await readSaleHeadline(userId, saleId);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { saleNo: true } });
    assert.deepEqual(headline, { saleNo: sale.saleNo, buyerName: "Jan Kowalski" });
  });
});
