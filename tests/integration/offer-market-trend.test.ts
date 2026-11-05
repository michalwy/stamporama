import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, getOfferDetail } from "../../src/lib/offers";
import { forgetRealizationRatios } from "@/lib/realization-ratio-cache";

// The offer's price table shows Market trend under Market (#2461): the same copies' results, each
// brought to today by the stamp's price trend (#2460's rule). Market itself stays the plain median.

describe("the offer's Market trend row (#2461)", () => {
  beforeEach(() => forgetRealizationRatios());

  let userId: string;
  let collectionId: string;
  let platformId: string;
  let areaId: string;
  let conditionId: string;
  let sellerId: string;
  let seq = 0;

  const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
  const yearsAgo = (years: number) => new Date(Date.now() - years * YEAR_MS);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-market-trend-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User market-trend-${ts}`,
        email: `test-market-trend-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-market-trend-${ts}`, name: `Collection market-trend-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })).id;
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function stamp(name: string): Promise<string> {
    return (
      await prisma.stamp.create({
        data: {
          collectionId,
          name,
          issuedYear: 1950,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
  }

  /** One closed lot of one copy of `stampId`, sold `years` ago at `price` EUR. */
  async function result(stampId: string, price: string, years: number) {
    const saleId = (
      await prisma.auctionSale.create({
        data: { collectionId, sellerId, platformId, name: `Sale ${++seq}`, currency: "EUR" },
      })
    ).id;
    await prisma.auctionLot.create({
      data: {
        auctionSaleId: saleId,
        auctionLotNo: 9700 + seq,
        lotNo: String(seq),
        endsAt: yearsAgo(years),
        status: "closed",
        finalPrice: price,
        lines: { create: [{ stampId, conditionId, certificateStatusId: null, formatId: null, quantity: 1 }] },
      },
    });
  }

  async function offerOf(stampId: string) {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
    });
    await addOfferSet(userId, offerId, [item.id]);
    const detail = await getOfferDetail(userId, offerId);
    assert.ok(detail);
    return detail;
  }

  it("shows a rising stamp's Market at its median and Market trend above it, with the rate", async () => {
    const stampId = await stamp("Rising");
    // #2460's example: 8.00, 9.00, 10.50 and 12.00 a year apart, the last a year ago.
    for (const [price, years] of [["8.00", 4], ["9.00", 3], ["10.50", 2], ["12.00", 1]] as const) {
      await result(stampId, price, years);
    }
    const detail = await offerOf(stampId);
    assert.equal(detail.marketPrice?.amount, "9.75");
    const trend = detail.marketTrendPrice;
    assert.ok(trend);
    assert.ok(Number(trend.amount) > 13.25 && Number(trend.amount) < 14.25, `trend ${trend.amount}`);
    assert.equal(trend.copies, 1);
    assert.equal(trend.trendedCopies, 1);
    assert.equal(trend.trends.length, 1);
    assert.equal(trend.trends[0].borrowed, null);
    assert.ok(trend.trends[0].rate > 0.13 && trend.trends[0].rate < 0.16, `rate ${trend.trends[0].rate}`);
  });

  it("has no Market trend where no trend applies, and Market reads as before", async () => {
    const stampId = await stamp("Thin");
    await result(stampId, "7.00", 0.1);
    const detail = await offerOf(stampId);
    assert.equal(detail.marketPrice?.amount, "7.00");
    assert.equal(detail.marketTrendPrice, null);
  });
});
