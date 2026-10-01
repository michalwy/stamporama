import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  auctionLotExposure,
  createAuctionLot,
  createAuctionSale,
  getAuctionSaleDetail,
  setAuctionLotBid,
  setAuctionLotMaxBid,
  setAuctionLotMyBid,
  setAuctionLotMyBidAndCeiling,
} from "../../src/lib/auctions";

// A lot's ceiling follows its bid unless it is set apart (#1515). The rule itself is `ceilingOf`
// and is unit-tested; what is worth a real database is that every write path leaves the stored
// figures meaning what the row reads them as — a bid typed by hand moves the ceiling, a ceiling set
// apart stays put, *Bid this* and its undo write both at once — and that the exposure totals read
// the same held ceiling the row does.

describe("auction ceiling follows the bid (#1515)", () => {
  let userId: string;
  let collectionId: string;
  let saleId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-ceiling-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ceiling-${ts}`,
        email: `test-ceiling-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-ceiling-${ts}`,
          name: `Collection ceiling-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;
    const sellerId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Philkam",
          seller: true,
          defaultCurrency: "PLN",
          buyerPremiumPercent: "10.00",
          buyerPremiumFixed: "2.00",
        },
      })
    ).id;
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    saleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: null,
      url: null,
      endsAt: null,
      currency: "",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
  });

  async function newLot(figures: { myBid?: string | null; maxBid?: string | null } = {}) {
    return createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: null,
      url: null,
      title: `Lot ${Math.random()}`,
      endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      startingPrice: null,
      currentBid: null,
      myBid: figures.myBid ?? null,
      maxBid: figures.maxBid ?? null,
      notes: null,
    });
  }

  async function row(lotId: string) {
    const lot = (await getAuctionSaleDetail(userId, saleId)).lots.find((l) => l.id === lotId);
    assert.ok(lot);
    return lot;
  }

  it("moves the ceiling with a bid typed by hand while none is set apart", async () => {
    const lotId = await newLot();
    assert.equal((await row(lotId)).ceiling, null);

    // 50 + 10% + 2 = 57 all-in is the ceiling, and nothing is stored for it.
    await setAuctionLotMyBid(userId, lotId, "50.00");
    let lot = await row(lotId);
    assert.equal(lot.maxBid, null);
    assert.equal(lot.ceilingSetApart, false);
    assert.equal(lot.ceiling, "57.00");
    assert.equal(lot.myBidOverCeiling, false);

    await setAuctionLotMyBid(userId, lotId, "60.00");
    lot = await row(lotId);
    assert.equal(lot.ceiling, "68.00");
    assert.equal(lot.ceilingSetApart, false);

    // Outbid, the price is past the ceiling too: one fact, so the row says both.
    await setAuctionLotBid(userId, lotId, "61.00");
    lot = await row(lotId);
    assert.equal(lot.standing, "outbid");
    assert.equal(lot.overCeiling, true);
  });

  it("keeps a ceiling set apart where it is when the bid changes, until it is cleared", async () => {
    const lotId = await newLot({ myBid: "50.00" });
    await setAuctionLotMaxBid(userId, lotId, "70.00");
    let lot = await row(lotId);
    assert.equal(lot.ceilingSetApart, true);
    assert.equal(lot.ceiling, "70.00");

    // 80 costs 90 all-in, past the 70 set apart: the ceiling holds and the bid goes amber.
    await setAuctionLotMyBid(userId, lotId, "80.00");
    lot = await row(lotId);
    assert.equal(lot.ceiling, "70.00");
    assert.equal(lot.myBidOverCeiling, true);

    await setAuctionLotMaxBid(userId, lotId, null);
    lot = await row(lotId);
    assert.equal(lot.ceilingSetApart, false);
    assert.equal(lot.ceiling, "90.00");
    assert.equal(lot.myBidOverCeiling, false);
  });

  it("writes the bid and clears a separate ceiling in one go for Bid this, and undoes both", async () => {
    const lotId = await newLot({ myBid: "40.00", maxBid: "120.00" });

    await setAuctionLotMyBidAndCeiling(userId, lotId, { myBid: "63.63", maxBid: null });
    let lot = await row(lotId);
    assert.equal(lot.myBid, "63.63");
    assert.equal(lot.ceilingSetApart, false);
    // 63.63 + 10% + 2 = 71.993 → 71.99, the bid's all-in.
    assert.equal(lot.ceiling, "71.99");

    // The undo puts back exactly what was there, the separate ceiling included.
    await setAuctionLotMyBidAndCeiling(userId, lotId, { myBid: "40.00", maxBid: "120.00" });
    lot = await row(lotId);
    assert.equal(lot.myBid, "40.00");
    assert.equal(lot.maxBid, "120.00");
    assert.equal(lot.ceilingSetApart, true);
  });

  it("costs a lot whose ceiling follows its bid at that bid in the exposure totals", async () => {
    const before = await auctionLotExposure(userId, collectionId, {});
    const lotId = await newLot({ myBid: "100.00" });
    const after = await auctionLotExposure(userId, collectionId, {});
    // The bid's 112 all-in, in the committed figure and in the ceiling one alike.
    // The sale trades in the collection's own currency, so the totals need no rate.
    const committed = (s: typeof after) => Number(s.committedTotal);
    const atCeiling = (s: typeof after) => Number(s.ceilingTotal);
    assert.equal((committed(after) - committed(before)).toFixed(2), "112.00");
    assert.equal((atCeiling(after) - atCeiling(before)).toFixed(2), "112.00");
    assert.equal(after.uncappedCount, before.uncappedCount);

    // Outbid, it is past both its bid and its ceiling, and drops out of both (#600).
    await setAuctionLotBid(userId, lotId, "150.00");
    const outbid = await auctionLotExposure(userId, collectionId, {});
    assert.equal(outbid.outpricedCount, after.outpricedCount + 1);
    assert.equal(committed(outbid).toFixed(2), committed(before).toFixed(2));
  });
});
