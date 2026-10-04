import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  auctionLotFilterCounts,
  confirmAuctionLotReviews,
  confirmAuctionSaleReview,
  createAuctionLot,
  createAuctionSale,
  getAuctionSaleDetail,
  listAuctionLots,
  listAuctionSales,
  markAuctionLotWrittenByApi,
  markAuctionSaleWrittenByApi,
  setAuctionLotBid,
  updateAuctionLot,
} from "../../src/lib/auctions";

// The *to review* marker on lots and sales written through the agent API (#1626): what a write
// leaves, how the lots list filters by it and a sale counts it, and that only *Confirm* clears it —
// editing a marked lot in the app leaves it standing.

describe("the to-review marker on auction lots and sales (#1626)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let saleId: string;
  let sellerId: string;
  let platformId: string;

  const inADay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  async function addLot(title: string, inSale = saleId): Promise<string> {
    return createAuctionLot(userId, collectionId, {
      auctionSaleId: inSale,
      lotNo: null,
      url: null,
      title,
      endsAt: inADay(),
      startingPrice: null,
      currentBid: null,
      myBid: null,
      maxBid: null,
      notes: null,
    });
  }

  async function newSale(): Promise<string> {
    return createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: `Sale ${Math.random()}`,
      url: null,
      endsAt: null,
      currency: "",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-review-${ts}`;
    otherUserId = `test-user-review-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-review-${ts}`, name: "Review", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-review-o-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: otherUserId },
      })
    ).id;
    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    saleId = await newSale();
  });

  it("leaves a lot unmarked when the collector writes it", async () => {
    const lotId = await addLot("Entered by hand");
    const { items } = await listAuctionLots(userId, collectionId, { saleId });
    assert.equal(items.find((l) => l.id === lotId)?.apiReview, null);
  });

  it("marks a lot the API created, then adds what it changed", async () => {
    const lotId = await addLot("Written by the assistant");
    await prisma.$transaction((tx) => markAuctionLotWrittenByApi(tx, lotId, { kind: "created" }));
    await prisma.$transaction((tx) =>
      markAuctionLotWrittenByApi(tx, lotId, { kind: "changed", fields: ["lines", "ceiling"] })
    );
    const { items } = await listAuctionLots(userId, collectionId, { saleId });
    const mark = items.find((l) => l.id === lotId)?.apiReview;
    assert.ok(mark);
    assert.equal(mark.created, true);
    assert.deepEqual(mark.fields, ["lines", "ceiling"]);
  });

  it("is not cleared by editing the lot in the app", async () => {
    const lotId = await addLot("Edited after the API wrote it");
    await prisma.$transaction((tx) => markAuctionLotWrittenByApi(tx, lotId, { kind: "created" }));
    await updateAuctionLot(userId, lotId, {
      auctionSaleId: saleId,
      lotNo: "7",
      url: null,
      title: "Retitled by the collector",
      endsAt: inADay(),
      startingPrice: null,
      currentBid: null,
      myBid: null,
      maxBid: null,
      notes: null,
    });
    await setAuctionLotBid(userId, lotId, "12.00");
    const row = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { apiReviewAt: true, title: true },
    });
    assert.equal(row.title, "Retitled by the collector");
    assert.notEqual(row.apiReviewAt, null, "an edit in the app must not count as a review");
  });

  it("filters the lots list by the marker and counts it", async () => {
    const sale = await newSale();
    const marked = await addLot("Marked", sale);
    await addLot("Unmarked", sale);
    await prisma.$transaction((tx) => markAuctionLotWrittenByApi(tx, marked, { kind: "created" }));

    const { items } = await listAuctionLots(userId, collectionId, {
      sellerId,
      toReview: true,
      search: "Marked",
    });
    assert.deepEqual(
      items.map((l) => l.id),
      [marked],
      "only the marked lot answers the filter"
    );
    const counts = await auctionLotFilterCounts(userId, collectionId, { search: "Marked" });
    // "Marked" and "Unmarked" both match the search; only one carries the marker.
    assert.equal(counts.total, 2);
    assert.equal(counts.toReview, 1);
  });

  it("shows on a sale with the count of its marked lots, and on a sale the API wrote", async () => {
    const sale = await newSale();
    const a = await addLot("A", sale);
    const b = await addLot("B", sale);
    await addLot("C", sale);
    await prisma.$transaction(async (tx) => {
      await markAuctionLotWrittenByApi(tx, a, { kind: "created" });
      await markAuctionLotWrittenByApi(tx, b, { kind: "changed", fields: ["currentBid"] });
    });
    let detail = await getAuctionSaleDetail(userId, sale);
    assert.equal(detail.lotsToReview, 2);
    assert.equal(detail.apiReview, null, "a lot written into a sale marks the lot, not the sale");

    const other = await newSale();
    await prisma.$transaction((tx) =>
      markAuctionSaleWrittenByApi(tx, other, { kind: "changed", fields: ["premium"] })
    );
    const listed = (await listAuctionSales(userId, collectionId)).find((s) => s.id === other);
    assert.deepEqual(listed?.apiReview?.fields, ["premium"]);
    assert.equal(listed?.lotsToReview, 0);

    detail = await getAuctionSaleDetail(userId, sale);
    assert.equal(detail.lots.filter((l) => l.apiReview !== null).length, 2);
  });

  it("is cleared by Confirm on ticked lots, and only on those", async () => {
    const sale = await newSale();
    const a = await addLot("A", sale);
    const b = await addLot("B", sale);
    const c = await addLot("C", sale);
    await prisma.$transaction(async (tx) => {
      for (const id of [a, b, c]) await markAuctionLotWrittenByApi(tx, id, { kind: "created" });
    });
    const unmarked = await addLot("D", sale);
    // An unmarked lot in the batch is already confirmed, not an error.
    const cleared = await confirmAuctionLotReviews(userId, collectionId, [a, b, unmarked]);
    assert.equal(cleared, 2);
    const detail = await getAuctionSaleDetail(userId, sale);
    assert.deepEqual(
      detail.lots.filter((l) => l.apiReview !== null).map((l) => l.id),
      [c]
    );
    assert.equal(detail.lotsToReview, 1);
  });

  it("is cleared for a whole sale — the sale's own marker and every lot's", async () => {
    const sale = await newSale();
    const a = await addLot("A", sale);
    const b = await addLot("B", sale);
    await prisma.$transaction(async (tx) => {
      await markAuctionSaleWrittenByApi(tx, sale, { kind: "created" });
      await markAuctionLotWrittenByApi(tx, a, { kind: "created" });
      await markAuctionLotWrittenByApi(tx, b, { kind: "changed", fields: ["ceiling"] });
    });
    assert.equal(await confirmAuctionSaleReview(userId, sale), 2);
    const detail = await getAuctionSaleDetail(userId, sale);
    assert.equal(detail.apiReview, null);
    assert.equal(detail.lotsToReview, 0);
    const row = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: b },
      select: { apiReviewCreated: true, apiReviewFields: true },
    });
    assert.deepEqual(row, { apiReviewCreated: false, apiReviewFields: [] });
  });

  it("refuses to confirm lots the owner does not hold, and writes nothing", async () => {
    const lotId = await addLot("Not theirs");
    await prisma.$transaction((tx) => markAuctionLotWrittenByApi(tx, lotId, { kind: "created" }));
    await assert.rejects(confirmAuctionLotReviews(otherUserId, otherCollectionId, [lotId]));
    await assert.rejects(confirmAuctionSaleReview(otherUserId, saleId));
    const row = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { apiReviewAt: true },
    });
    assert.notEqual(row.apiReviewAt, null);
  });
});
