import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  AuctionActionBlockedError,
  auctionLotFilterCounts,
  createAuctionLot,
  createAuctionLotLine,
  createAuctionSale,
  getAuctionLotComposition,
  getAuctionSaleDetail,
  listAuctionLots,
  recordAuctionLotTransition,
  settleAuctionSale,
  updateAuctionLotLine,
} from "../../src/lib/auctions";
import { readStampMarketValues } from "../../src/lib/market-values";
import { getAuctionLotBidEvidence } from "../../src/lib/bid-recommendations";

// A lot line's condition can be unknown, or one of several (#1623).
//
// What earns a real database here is that the range is assembled from the very valuation every
// other figure uses, at each condition the line may be in — so these tests check the rules reach
// the screens' reads: the lot's own composition, its row on the list, the filter and its count,
// the parcel's totals, the recommendation, settlement, and the market evidence that must not count
// a lot whose conditions are not settled.
//
// Base and sale currency are both EUR, so no exchange rate is fetched.

describe("auction lot line condition ranges (#1623)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let platformId: string;
  let mnhId: string;
  let mhId: string;
  /** No catalogue price for any stamp here — an unknown condition ranges over it and leaves it out. */
  let damagedId: string;
  /** Priced MNH 40.00, MH 20.00. */
  let stampId: string;

  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  async function newSale(name: string): Promise<string> {
    return createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name,
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
  }

  async function newLot(saleId: string, title: string, myBid: string | null = null): Promise<string> {
    return createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: null,
      url: null,
      title,
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: "10.00",
      myBid,
      maxBid: null,
      notes: null,
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-aucrange-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User aucrange-${ts}`,
        email: `test-aucrange-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-aucrange-${ts}`, name: `aucrange-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    const editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;
    const areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;

    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    mhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Hinged", abbreviation: "MH", sortOrder: 1 },
      })
    ).id;
    damagedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Damaged", abbreviation: "D", sortOrder: 2 },
      })
    ).id;

    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Range stamp" } })).id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: areaId, isPrimary: true },
    });
    for (const [conditionId, price] of [
      [mnhId, "40.00"],
      [mhId, "20.00"],
    ] as const) {
      await prisma.stampCatalogPrice.create({
        data: { stampId, catalogEditionId: editionId, conditionId, price, currency: "EUR" },
      });
    }

    sellerId = (await prisma.contact.create({ data: { collectionId, name: "House", seller: true } })).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Philasearch", platform: true } })
    ).id;
  });

  after(async () => {
    // Sales first (`AuctionLotLine.stampId` is `Restrict`), then the copies settlement wrote.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("values a line that is one of several conditions as a range, and marks the lot", async () => {
    const saleId = await newSale("One of");
    const lotId = await newLot(saleId, "Czysty");
    await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId: null,
      possibleConditionIds: [mnhId, mhId],
      certificateStatusId: null,
      formatId: null,
      quantity: 2,
    });

    const composition = await getAuctionLotComposition(userId, lotId);
    const [line] = composition.lines;
    assert.equal(line.conditionId, null);
    assert.deepEqual(line.possibleConditionIds.sort(), [mnhId, mhId].sort());
    assert.equal(line.conditionAbbreviation, "MNH or MH");
    assert.equal(line.lineValue, "40.00");
    assert.equal(line.lineValueHigh, "80.00");
    // The low end is what is summed and compared; the high end is stated beside it.
    assert.equal(composition.catalogValue, "40.00");
    assert.equal(composition.catalogValueHigh, "80.00");
    assert.equal(composition.unsettledLines, 1);
    assert.equal(composition.headroom, "30.00");
    assert.equal(composition.headroomHigh, "70.00");

    const { items } = await listAuctionLots(userId, collectionId, { saleId });
    const row = items.find((item) => item.id === lotId)!;
    assert.equal(row.conditionToSettle, true);
    assert.equal(row.catalogValue, "40.00");
    assert.equal(row.catalogValueHigh, "80.00");
    assert.deepEqual(row.unsettledLines, [
      { stamp: "Range stamp", possibleConditions: ["MNH", "MH"], unknown: false },
    ]);
    // The recommendation is a range too, and its low end is what is bid.
    assert.ok(row.recommendation?.high, "a range lot carries the recommendation's high end");
    assert.ok(
      Number(row.recommendation!.high!.fair.allIn) > Number(row.recommendation!.fair!.allIn),
      "the high end is above the low end"
    );

    const evidence = await getAuctionLotBidEvidence(userId, lotId);
    assert.equal(evidence!.lines[0].conditions?.length, 2);
  });

  it("ranges an unknown condition over every condition, leaving out the one with no price", async () => {
    const saleId = await newSale("Unknown");
    const lotId = await newLot(saleId, "No grade stated");
    await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId: null,
      possibleConditionIds: [],
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    const [line] = (await getAuctionLotComposition(userId, lotId)).lines;
    assert.equal(line.conditions.length, 3);
    assert.equal(line.unitValue, "20.00");
    assert.equal(line.unitValueHigh, "40.00");
    assert.equal(line.unpricedConditions, 1);
    assert.equal(line.unpriced, false);
  });

  it("collapses a set of one into that condition, and clears the set when the line is settled", async () => {
    const saleId = await newSale("Settle by edit");
    const lotId = await newLot(saleId, "Edited");
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId: null,
      possibleConditionIds: [mhId],
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    let stored = await prisma.auctionLotLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { conditionId: true, possibleConditions: true },
    });
    assert.equal(stored.conditionId, mhId);
    assert.equal(stored.possibleConditions.length, 0);

    await updateAuctionLotLine(userId, lineId, {
      stampId,
      conditionId: null,
      possibleConditionIds: [mnhId, mhId],
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    await updateAuctionLotLine(userId, lineId, {
      stampId,
      conditionId: mnhId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    stored = await prisma.auctionLotLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { conditionId: true, possibleConditions: true },
    });
    assert.equal(stored.conditionId, mnhId);
    assert.equal(stored.possibleConditions.length, 0);
    const composition = await getAuctionLotComposition(userId, lotId);
    assert.equal(composition.unsettledLines, 0);
    assert.equal(composition.catalogValueHigh, null);
  });

  it("refuses a possible condition from outside the collection", async () => {
    const saleId = await newSale("Bad");
    const lotId = await newLot(saleId, "Bad");
    await assert.rejects(
      createAuctionLotLine(userId, lotId, {
        stampId,
        conditionId: null,
        possibleConditionIds: [mnhId, "not-a-condition"],
        certificateStatusId: null,
        formatId: null,
        quantity: 1,
      }),
      AuctionActionBlockedError
    );
  });

  it("filters the list down to lots with a condition to settle, and counts them", async () => {
    const filtered = await listAuctionLots(userId, collectionId, { conditionToSettle: true });
    assert.ok(filtered.items.length > 0);
    assert.ok(filtered.items.every((item) => item.conditionToSettle));
    const counts = await auctionLotFilterCounts(userId, collectionId, {});
    assert.equal(counts.conditionToSettle, filtered.items.length);
  });

  it("says the parcel's catalogue total is the low end, with the high end beside it", async () => {
    const saleId = await newSale("Parcel");
    const lotId = await newLot(saleId, "Parcel lot", "10.00");
    await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId: null,
      possibleConditionIds: [mnhId, mhId],
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    const sale = await getAuctionSaleDetail(userId, saleId);
    assert.equal(sale.summary.catalogTotal, "20.00");
    assert.equal(sale.summary.catalogTotalHigh, "40.00");
    assert.equal(sale.summary.rangeLotCount, 1);
  });

  it("settles a won lot only once each line has one condition, and settles the line at it", async () => {
    const saleId = await newSale("Won");
    const lotId = await newLot(saleId, "Won lot", "30.00");
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId: null,
      possibleConditionIds: [mnhId, mhId],
      certificateStatusId: null,
      formatId: null,
      quantity: 2,
    });
    await recordAuctionLotTransition(userId, lotId, {
      status: "closed",
      finalPrice: "25.00",
      wonTie: null,
    });
    const input = { purchasedAt: "2026-10-04", shippingCost: null, lots: [{ lotId, price: 25 }] };

    await assert.rejects(settleAuctionSale(userId, saleId, input), (e: unknown) => {
      assert.ok(e instanceof AuctionActionBlockedError);
      assert.equal(e.reason, "condition-unsettled");
      return true;
    });
    // A condition the line never said it might be in is refused too.
    await assert.rejects(
      settleAuctionSale(userId, saleId, {
        ...input,
        lineConditions: [{ lineId, conditionId: damagedId }],
      }),
      AuctionActionBlockedError
    );
    assert.equal(await prisma.purchase.count({ where: { collectionId } }), 0);

    const { purchaseId } = await settleAuctionSale(userId, saleId, {
      ...input,
      lineConditions: [{ lineId, conditionId: mhId }],
    });
    const copies = await prisma.item.findMany({
      where: { lot: { purchaseId } },
      select: { conditionId: true },
    });
    assert.equal(copies.length, 2);
    assert.ok(copies.every((copy) => copy.conditionId === mhId));
    const line = await prisma.auctionLotLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { conditionId: true, possibleConditions: true },
    });
    assert.equal(line.conditionId, mhId);
    assert.equal(line.possibleConditions.length, 0);
  });

  it("leaves a closed lot out of the market evidence until its conditions are settled", async () => {
    const saleId = await newSale("Observed");
    const lotId = await newLot(saleId, "Observed lot");
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId: null,
      possibleConditionIds: [mnhId, mhId],
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    await recordAuctionLotTransition(userId, lotId, {
      status: "closed",
      finalPrice: "33.00",
      wonTie: null,
    });
    const before = (await readStampMarketValues(collectionId, [stampId])).get(stampId) ?? [];
    const countAt = (values: typeof before, conditionId: string) =>
      values.find((value) => value.conditionId === conditionId)?.n ?? 0;
    const mnhBefore = countAt(before, mnhId);

    await updateAuctionLotLine(userId, lineId, {
      stampId,
      conditionId: mnhId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    const afterSettling = (await readStampMarketValues(collectionId, [stampId])).get(stampId) ?? [];
    assert.equal(countAt(afterSettling, mnhId), mnhBefore + 1);
  });
});
