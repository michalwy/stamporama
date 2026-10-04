import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  AuctionActionBlockedError,
  auctionLotFilterCounts,
  createAuctionLot,
  createAuctionLotLine,
  createAuctionSale,
  deleteAuctionLotLine,
  getAuctionSaleDetail,
  listAuctionLots,
  recordAuctionLotTransition,
  setAuctionLotMyBid,
  setAuctionLotNotStamps,
  settleAuctionSale,
} from "../../src/lib/auctions";
import { getPurchaseDetail } from "../../src/lib/lots";
import { deletePurchaseExpense } from "../../src/lib/purchase-expenses";

// A lot that is not stamps (#1624): a catalogue, literature or an accessory, bid on and tracked like
// any lot. What earns a real database is the two ends of it — the lot reads as nothing left to
// describe on every surface that counted it undescribed, and a won one settles into the purchase as
// an expense that takes its share of the shipping, with no copy, frozen until the expense goes.
//
// Base currency and sale currency are both EUR, as in the settlement suite, so no rate is fetched.

describe("auction lots that are not stamps (#1624)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let sellerId: string;
  let platformId: string;

  const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  async function newSale(name: string): Promise<string> {
    return createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name,
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: "15.00",
      premiumPercent: "10.00",
      premiumFixed: "2.00",
    });
  }

  async function newLot(saleId: string, title: string | null, endsAt = hourAgo()): Promise<string> {
    return createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "7",
      url: null,
      title,
      endsAt,
      startingPrice: null,
      currentBid: "40.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });
  }

  async function closeWon(lotId: string, finalPrice: string): Promise<void> {
    await setAuctionLotMyBid(userId, lotId, (Number(finalPrice) + 10).toFixed(2));
    await recordAuctionLotTransition(userId, lotId, { status: "closed", finalPrice, wonTie: null });
  }

  function blocked(reason: string) {
    return (err: unknown) => err instanceof AuctionActionBlockedError && err.reason === reason;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-aucnotstamps-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User aucnotstamps-${ts}`,
        email: `test-aucnotstamps-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-aucnotstamps-${ts}`,
          name: `Collection aucnotstamps-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } }))
      .id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Alpha" } })).id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: areaId, isPrimary: true },
    });
    sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Antykwariat", seller: true } })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("is never undescribed once marked, on the list, its filter and the sale's rollup", async () => {
    const saleId = await newSale("Books");
    const lotId = await newLot(saleId, "Katalog Fischer 2020", hourFromNow());

    const before = await auctionLotFilterCounts(userId, collectionId, { saleId });
    assert.equal(before.undescribed, 1);

    await setAuctionLotNotStamps(userId, lotId, {
      notStamps: true,
      description: "  Fischer catalogue 2020  ",
    });

    const { items } = await listAuctionLots(userId, collectionId, { saleId });
    const lot = items.find((l) => l.id === lotId)!;
    assert.equal(lot.notStamps, true);
    // The write is trimmed like every other (ADR-0055).
    assert.equal(lot.notStampsDescription, "Fischer catalogue 2020");
    assert.equal(lot.catalogValue, null);
    assert.equal(lot.recommendation, null);

    const after = await auctionLotFilterCounts(userId, collectionId, { saleId });
    assert.equal(after.undescribed, 0);
    const undescribed = await listAuctionLots(userId, collectionId, { saleId, undescribed: true });
    assert.equal(undescribed.items.length, 0);

    // Payable, so it is still money the parcel costs — but not a lot missing its catalogue value.
    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.summary.payableCount, 1);
    assert.equal(detail.summary.unvaluedCount, 0);
  });

  it("refuses the mark on a lot holding stamps, and a stamp on a marked lot", async () => {
    const saleId = await newSale("Mixed up");
    const lotId = await newLot(saleId, "Stockbook", hourFromNow());
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });

    await assert.rejects(
      () => setAuctionLotNotStamps(userId, lotId, { notStamps: true, description: null }),
      blocked("has-lines")
    );

    await deleteAuctionLotLine(userId, lineId);
    await setAuctionLotNotStamps(userId, lotId, { notStamps: true, description: null });
    await assert.rejects(
      () =>
        createAuctionLotLine(userId, lotId, {
          stampId,
          conditionId,
          certificateStatusId: null,
          formatId: null,
          quantity: 1,
        }),
      blocked("not-stamps")
    );
  });

  it("comes off while the lot is open, and not once it has closed", async () => {
    const saleId = await newSale("Changed mind");
    const lotId = await newLot(saleId, "Lupa", hourFromNow());
    await setAuctionLotNotStamps(userId, lotId, { notStamps: true, description: "Magnifier" });

    // Removing the mark makes it an ordinary lot again, and forgets what it was said to be.
    await setAuctionLotNotStamps(userId, lotId, { notStamps: false, description: "ignored" });
    let row = await prisma.auctionLot.findUniqueOrThrow({ where: { id: lotId } });
    assert.equal(row.notStamps, false);
    assert.equal(row.notStampsDescription, null);

    await setAuctionLotNotStamps(userId, lotId, { notStamps: true, description: "Magnifier" });
    await closeWon(lotId, "20.00");
    await assert.rejects(
      () => setAuctionLotNotStamps(userId, lotId, { notStamps: false, description: null }),
      blocked("not-stamps")
    );
    // What it is can still be restated after the close; only the mark itself stays.
    await setAuctionLotNotStamps(userId, lotId, { notStamps: true, description: "Lupa 10x" });
    row = await prisma.auctionLot.findUniqueOrThrow({ where: { id: lotId } });
    assert.equal(row.notStamps, true);
    assert.equal(row.notStampsDescription, "Lupa 10x");
  });

  it("settles a won one as an expense with its share of the shipping, and no copy", async () => {
    const saleId = await newSale("Parcel with a catalogue");
    const stampsId = await newLot(saleId, "Poland 1950");
    await createAuctionLotLine(userId, stampsId, {
      stampId,
      conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 2,
    });
    const bookId = await newLot(saleId, "Katalog");
    await setAuctionLotNotStamps(userId, bookId, {
      notStamps: true,
      description: "Fischer catalogue 2020",
    });
    await closeWon(stampsId, "100.00");
    await closeWon(bookId, "40.00");

    const { purchaseId } = await settleAuctionSale(userId, saleId, {
      purchasedAt: "2026-10-04",
      shippingCost: 15,
      lots: [
        { lotId: stampsId, price: 112 },
        { lotId: bookId, price: 48 },
      ],
    });

    const purchase = (await getPurchaseDetail(userId, purchaseId))!;
    assert.equal(purchase.lots.length, 1);
    assert.equal(purchase.lots[0].title, "Poland 1950");
    assert.deepEqual(
      purchase.expenses.map((e) => [e.label, e.price]),
      [["Fischer catalogue 2020", "48.00"]]
    );
    // Shipping is spread over lots and expenses by price (ADR-0009 §3): 15 × 112 / 160 = 10.50 lands
    // on the stamps, the rest on the catalogue — so the stamps are not costed for it.
    assert.equal(purchase.lots[0].poolTx, "122.50");
    // Two copies, both from the stamps lot; the catalogue made none.
    const copies = await prisma.item.findMany({
      where: { lot: { purchaseId } },
      select: { lotId: true },
    });
    assert.equal(copies.length, 2);
    assert.ok(copies.every((c) => c.lotId === purchase.lots[0].id));

    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.lots.find((l) => l.id === bookId)!.settled, true);
  });

  it("is frozen once settled, and deleting the expense undoes that", async () => {
    const saleId = await newSale("Only a book");
    const bookId = await newLot(saleId, null);
    await setAuctionLotNotStamps(userId, bookId, { notStamps: true, description: null });
    await closeWon(bookId, "10.00");

    // A parcel holding nothing but the book is still a purchase — of one expense. With no
    // description and no title the label falls back to the house's number.
    const { purchaseId } = await settleAuctionSale(userId, saleId, {
      purchasedAt: "2026-10-04",
      shippingCost: null,
      lots: [{ lotId: bookId, price: 13 }],
    });
    const purchase = (await getPurchaseDetail(userId, purchaseId))!;
    assert.equal(purchase.lots.length, 0);
    assert.deepEqual(
      purchase.expenses.map((e) => [e.label, e.price]),
      [["Lot 7", "13.00"]]
    );

    await assert.rejects(
      () => setAuctionLotNotStamps(userId, bookId, { notStamps: true, description: "Album" }),
      blocked("settled")
    );

    await deletePurchaseExpense(userId, purchase.expenses[0].id);
    const lot = await prisma.auctionLot.findUniqueOrThrow({ where: { id: bookId } });
    // The bidding record stands, and is editable again.
    assert.equal(lot.purchaseExpenseId, null);
    await setAuctionLotNotStamps(userId, bookId, { notStamps: true, description: "Album" });
  });
});
