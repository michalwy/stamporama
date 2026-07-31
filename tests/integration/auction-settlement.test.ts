import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  AuctionActionBlockedError,
  createAuctionLot,
  createAuctionLotLine,
  createAuctionSale,
  getAuctionSaleDetail,
  recordAuctionLotTransition,
  setAuctionLotMyBid,
  settleAuctionSale,
  updateAuctionLot,
} from "../../src/lib/auctions";
import { getPurchaseDetail } from "../../src/lib/lots";

// Settling a parcel of won lots into a purchase (#28; ADR-0021 §7).
//
// This is a transcription across four tables, so what earns a real database is that the *result* is
// a purchase the rest of the app can already work with: lines priced at hammer + premium, copies
// carrying the composition's condition / certificate / format, internal numbers allocated, and the
// bidding record left standing on the other side of a `SetNull` link.
//
// Base currency and sale currency are both EUR so no exchange rate is fetched — the conversion path
// has its own coverage, and a network call here would make the suite fail offline.

describe("auction settlement (#28)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let attestId: string;
  let pairFormatId: string;
  let areaId: string;
  let stampA: string;
  let stampB: string;
  let sellerId: string;
  let platformId: string;

  const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  /** A fresh parcel per test: settlement is terminal, so tests cannot share one. */
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

  async function newLot(
    saleId: string,
    title: string | null,
    endsAt = hourAgo()
  ): Promise<string> {
    return createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "1",
      url: null,
      title,
      endsAt,
      startingPrice: null,
      currentBid: "100.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });
  }

  // Outcomes are derived from the money (ADR-0021 §4), so a test cannot declare a lot won — it has
  // to make the figures say so. Winning pays the runner-up's maximum plus an increment, which lands
  // *below* your own maximum; being outbid puts the result above it. These two helpers set up each
  // shape and then close the lot, which is the only thing the collector actually records.
  async function closeWon(owner: string, lotId: string, finalPrice: string): Promise<void> {
    await setAuctionLotMyBid(owner, lotId, (Number(finalPrice) + 10).toFixed(2));
    await recordAuctionLotTransition(owner, lotId, { status: "closed", finalPrice, wonTie: null });
  }

  async function closeLost(owner: string, lotId: string, finalPrice: string): Promise<void> {
    await setAuctionLotMyBid(owner, lotId, (Number(finalPrice) - 10).toFixed(2));
    await recordAuctionLotTransition(owner, lotId, { status: "closed", finalPrice, wonTie: null });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-aucsettle-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User aucsettle-${ts}`,
        email: `test-aucsettle-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-aucsettle-${ts}`,
        name: `Collection aucsettle-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    attestId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Fotoattest", abbreviation: "FA", sortOrder: 0 },
      })
    ).id;
    pairFormatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Pair", abbreviation: "Pr", sortOrder: 0 },
      })
    ).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;

    async function stamp(name: string): Promise<string> {
      const s = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
      });
      return s.id;
    }
    stampA = await stamp("Alpha");
    stampB = await stamp("Beta");

    sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
  });

  after(async () => {
    // Sales first, for the same reason as the composition suite: `AuctionLotLine.stampId` is
    // `Restrict`, so dropping the collection would race its own cascades. Purchases next, because
    // an `Item` holds its lot with `Restrict` too.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("transcribes won lots into a purchase and writes their contents as copies", async () => {
    const saleId = await newSale("Köhler 385");
    const wonId = await newLot(saleId, "Poland 1950 complete");
    const lostId = await newLot(saleId, "Runner-up");

    // Two stamps, one of them a pair with a certificate and a quantity of 3 — the axes that must
    // survive the transcription intact.
    await createAuctionLotLine(userId, wonId, {
      stampId: stampA,
      conditionId,
      certificateStatusId: attestId,
      formatId: pairFormatId,
      quantity: 3,
    });
    await createAuctionLotLine(userId, wonId, {
      stampId: stampB,
      conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });

    await closeWon(userId, wonId, "100.00");
    await closeLost(userId, lostId, "80.00");

    // 100 hammer + 10% + 2 fixed. Shipping is deliberately absent from the line and lands on the
    // purchase, where ADR-0009 §3 distributes it.
    const { purchaseId } = await settleAuctionSale(userId, saleId, {
      purchasedAt: "2026-03-05",
      shippingCost: 15,
      lots: [{ lotId: wonId, price: 112 }],
    });

    const purchase = await getPurchaseDetail(userId, purchaseId);
    assert.ok(purchase);
    assert.equal(purchase.contactName, "Philkam");
    assert.equal(purchase.platformName, "Allegro");
    assert.equal(purchase.currency, "EUR");
    assert.equal(purchase.purchasedAt, "2026-03-05");
    assert.equal(purchase.shippingCost, "15.00");
    assert.equal(purchase.lots.length, 1);
    assert.equal(purchase.lots[0].price, "112.00");
    assert.equal(purchase.lots[0].title, "Poland 1950 complete");
    assert.equal(purchase.lots[0].status, "open");
    // The whole shared cost lands on the only line there is: 112 + 15.
    assert.equal(purchase.lots[0].poolTx, "127.00");
    // A settled purchase points back at the parcel it came from.
    assert.equal(purchase.auctionSale?.id, saleId);

    // A line of quantity 3 is three copies — a copy is one physical piece, and a multiple is one
    // copy in a format, never three singles.
    const copies = await prisma.item.findMany({
      where: { lotId: purchase.lots[0].id },
      orderBy: { itemNo: "asc" },
      select: {
        stampId: true,
        conditionId: true,
        certificateStatusId: true,
        formatId: true,
        itemNo: true,
        deliveryState: true,
        inCollection: true,
        costBasis: true,
      },
    });
    assert.equal(copies.length, 4);
    assert.equal(copies.filter((c) => c.stampId === stampA).length, 3);
    assert.equal(copies.filter((c) => c.stampId === stampB).length, 1);
    for (const copy of copies.filter((c) => c.stampId === stampA)) {
      assert.equal(copy.certificateStatusId, attestId);
      assert.equal(copy.formatId, pairFormatId);
    }
    for (const copy of copies) {
      assert.equal(copy.conditionId, conditionId);
      // Bought, not yet in hand, and not a holding until it has been sorted (ADR-0009 §5).
      assert.equal(copy.deliveryState, "ordered");
      assert.equal(copy.inCollection, false);
      // Cost is frozen when the lot is closed, not here.
      assert.equal(copy.costBasis, null);
    }
    // One consecutive range of internal numbers for the whole settlement (#268).
    const nos = copies.map((c) => c.itemNo);
    assert.deepEqual(nos, [nos[0], nos[0] + 1, nos[0] + 2, nos[0] + 3]);

    // Both-way links, and the lost lot untouched — it is the price datapoint the parcel produced.
    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.status, "settled");
    assert.equal(detail.purchaseId, purchaseId);
    const won = detail.lots.find((l) => l.id === wonId)!;
    const lost = detail.lots.find((l) => l.id === lostId)!;
    assert.equal(won.settled, true);
    assert.equal(lost.settled, false);
    assert.equal(lost.outcome, "lost");
    assert.equal(lost.finalPrice, "80.00");
  });

  it("names an untitled lot after what it holds", async () => {
    const saleId = await newSale("Untitled-lot parcel");
    const lotId = await newLot(saleId, null);
    await createAuctionLotLine(userId, lotId, {
      stampId: stampA,
      conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    await closeWon(userId, lotId, "10.00");

    const { purchaseId } = await settleAuctionSale(userId, saleId, {
      purchasedAt: "2026-03-06",
      shippingCost: null,
      lots: [{ lotId, price: 13 }],
    });
    const purchase = await getPurchaseDetail(userId, purchaseId);
    // The same derived label the watchlist shows, stored — from here on the line is a purchase's.
    assert.equal(purchase!.lots[0].title, "Alpha");
  });

  it("leaves out the won lots the collector excluded, and refuses a second settlement", async () => {
    const saleId = await newSale("Two wins, one parcel");
    const takenId = await newLot(saleId, "Taken");
    const heldBackId = await newLot(saleId, "Shipping separately");
    await closeWon(userId, takenId, "20.00");
    await closeWon(userId, heldBackId, "30.00");

    await settleAuctionSale(userId, saleId, {
      purchasedAt: "2026-03-07",
      shippingCost: null,
      lots: [{ lotId: takenId, price: 24 }],
    });

    const detail = await getAuctionSaleDetail(userId, saleId);
    const heldBack = detail.lots.find((l) => l.id === heldBackId)!;
    // Nothing about it is lost — it is still won, still priced, and simply not in this purchase.
    assert.equal(heldBack.outcome, "won");
    assert.equal(heldBack.finalPrice, "30.00");
    assert.equal(heldBack.settled, false);

    await assert.rejects(
      () =>
        settleAuctionSale(userId, saleId, {
          purchasedAt: "2026-03-08",
          shippingCost: null,
          lots: [{ lotId: heldBackId, price: 33 }],
        }),
      (err: unknown) =>
        err instanceof AuctionActionBlockedError && err.reason === "settled"
    );
  });

  it("refuses to settle while a lot is still being watched", async () => {
    const saleId = await newSale("Still running");
    const wonId = await newLot(saleId, "Won");
    await newLot(saleId, "Still open", hourFromNow());
    await closeWon(userId, wonId, "40.00");

    await assert.rejects(
      () =>
        settleAuctionSale(userId, saleId, {
          purchasedAt: "2026-03-09",
          shippingCost: null,
          lots: [{ lotId: wonId, price: 46 }],
        }),
      (err: unknown) =>
        err instanceof AuctionActionBlockedError && err.reason === "unresolved"
    );
  });

  it("refuses a parcel with nothing in it, and a lot that was not won", async () => {
    const saleId = await newSale("Nothing won");
    const lostId = await newLot(saleId, "Lost");
    // Nothing was bid on it, so closing it records a lot that was only watched — not a win, and
    // therefore not something this parcel can be settled from.
    await recordAuctionLotTransition(userId, lostId, {
      status: "closed",
      finalPrice: null,
      wonTie: null,
    });

    await assert.rejects(
      () =>
        settleAuctionSale(userId, saleId, {
          purchasedAt: "2026-03-10",
          shippingCost: null,
          lots: [],
        }),
      (err: unknown) => err instanceof AuctionActionBlockedError && err.reason === "no-lots"
    );

    await assert.rejects(
      () =>
        settleAuctionSale(userId, saleId, {
          purchasedAt: "2026-03-10",
          shippingCost: null,
          lots: [{ lotId: lostId, price: 10 }],
        }),
      (err: unknown) => err instanceof AuctionActionBlockedError && err.reason === "bad-sale"
    );
  });

  it("freezes the bidding record once a lot is settled", async () => {
    const saleId = await newSale("Frozen");
    const lotId = await newLot(saleId, "Won");
    await closeWon(userId, lotId, "50.00");
    await settleAuctionSale(userId, saleId, {
      purchasedAt: "2026-03-11",
      shippingCost: null,
      lots: [{ lotId, price: 57 }],
    });

    await assert.rejects(
      () =>
        updateAuctionLot(userId, lotId, {
          auctionSaleId: saleId,
          lotNo: "2",
          url: null,
          title: "Renamed",
          endsAt: hourAgo(),
          startingPrice: null,
          currentBid: "999.00",
          myBid: null,
          maxBid: null,
          notes: null,
        }),
      (err: unknown) => err instanceof AuctionActionBlockedError && err.reason === "settled"
    );
  });

  it("leaves the bidding record standing when the purchase is deleted", async () => {
    const saleId = await newSale("Undone");
    const lotId = await newLot(saleId, "Won");
    await closeWon(userId, lotId, "60.00");
    const { purchaseId } = await settleAuctionSale(userId, saleId, {
      purchasedAt: "2026-03-12",
      shippingCost: null,
      lots: [{ lotId, price: 68 }],
    });

    // No copies were written (the lot has no composition), so the purchase deletes cleanly — which
    // is the documented way to undo a settlement.
    await prisma.purchase.delete({ where: { id: purchaseId } });

    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.purchaseId, null);
    assert.equal(detail.lots[0].settled, false);
    // The result itself is untouched: it is a datapoint in its own right (ADR-0021 §7).
    assert.equal(detail.lots[0].finalPrice, "60.00");
    assert.equal(detail.lots[0].outcome, "won");
  });
});
