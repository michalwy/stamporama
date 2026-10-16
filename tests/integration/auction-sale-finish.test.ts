import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  answerAuctionSaleFinish,
  createAuctionLot,
  createAuctionSale,
  getAuctionSaleDetail,
  recordAuctionLotOutcomeThroughApi,
  recordAuctionLotTransition,
  setAuctionLotMyBid,
} from "../../src/lib/auctions";

// Closing a sale's last open lot asks whether to settle or close the sale too (#1954).
//
// What earns a real database is the once-per-sale rule, which lives in a column, and that the
// sale's readiness is read off its lots whichever writer closed them — the screen's or the agent
// API's. Sale and base currency are both EUR so no exchange rate is fetched.

describe("auction sale finish question (#1954)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let platformId: string;

  const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

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

  async function newLot(saleId: string, myBid: string | null): Promise<string> {
    const lotId = await createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "1",
      url: null,
      title: "Lot",
      endsAt: hourAgo(),
      startingPrice: null,
      currentBid: "100.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });
    if (myBid) await setAuctionLotMyBid(userId, lotId, myBid);
    return lotId;
  }

  /** Close a lot at a price — won below the bid placed, lost above it. */
  const close = (lotId: string, finalPrice: string) =>
    recordAuctionLotTransition(userId, lotId, { status: "closed", finalPrice, wonTie: null });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-aucfinish-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User aucfinish-${ts}`,
        email: `test-aucfinish-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-aucfinish-${ts}`,
          name: `Collection aucfinish-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("asks to settle when the last open lot closes and something was won", async () => {
    const saleId = await newSale("Köhler 385");
    const won = await newLot(saleId, "120.00");
    const lost = await newLot(saleId, "80.00");

    assert.equal((await close(won, "100.00")).askToFinish, null, "a lot is still open");
    assert.equal((await getAuctionSaleDetail(userId, saleId)).finish, null);

    const { askToFinish } = await close(lost, "100.00");
    assert.deepEqual(askToFinish, { saleId, saleName: "Köhler 385", finish: "settle", wonCount: 1 });
    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.finish, "settle");
    assert.equal(detail.finishAsked, false);
  });

  it("asks to close when nothing was won, and a cancelled lot counts as closed", async () => {
    const saleId = await newSale("Nothing won");
    const lost = await newLot(saleId, "80.00");
    const withdrawn = await newLot(saleId, null);

    await close(lost, "100.00");
    const { askToFinish } = await recordAuctionLotTransition(userId, withdrawn, { status: "cancelled" });
    assert.equal(askToFinish?.finish, "close");
    assert.equal(askToFinish?.wonCount, 0);
  });

  it("asks once: not now leaves the sale open and ready, and closing again does not ask", async () => {
    const saleId = await newSale("Asked once");
    const lot = await newLot(saleId, "120.00");
    assert.equal((await close(lot, "100.00")).askToFinish?.finish, "settle");

    await answerAuctionSaleFinish(userId, saleId, "later");
    let detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.status, "open");
    assert.equal(detail.finish, "settle", "still ready — its own button does the rest");
    assert.equal(detail.finishAsked, true);

    const reopened = await recordAuctionLotTransition(userId, lot, { status: "open" });
    assert.equal(reopened.askToFinish, null);
    assert.equal((await getAuctionSaleDetail(userId, saleId)).finish, null);
    assert.equal((await close(lot, "100.00")).askToFinish, null, "not asked a second time");
    detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.finish, "settle");
  });

  it("close closes the sale, as its own button does", async () => {
    const saleId = await newSale("Closed from the question");
    const lot = await newLot(saleId, "80.00");
    assert.equal((await close(lot, "100.00")).askToFinish?.finish, "close");

    await answerAuctionSaleFinish(userId, saleId, "close");
    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.status, "closed");
    assert.equal(detail.finish, null);
    assert.equal(detail.finishAsked, true);
  });

  it("an outcome recorded through the agent API leaves the sale ready and unasked", async () => {
    const saleId = await newSale("Closed by the assistant");
    const lot = await newLot(saleId, "120.00");

    await recordAuctionLotOutcomeThroughApi(userId, collectionId, lot, {
      status: "closed",
      finalPrice: "100.00",
      wonTie: null,
    });
    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.finish, "settle");
    assert.equal(detail.finishAsked, false, "asked when the collector next opens it");
  });
});
