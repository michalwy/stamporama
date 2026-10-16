import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getActionItems } from "../../src/lib/action-items";
import {
  auctionLotFilterCounts,
  countAuctionLots,
  createAuctionLot,
  createAuctionSale,
  listAuctionLots,
  recordAuctionLotTransition,
  setAuctionLotMyBid,
  settleAuctionSale,
} from "../../src/lib/auctions";
import { getDashboardSection } from "../../src/lib/dashboard";

// The dashboard's *Auctions I bid in* section (#1812). Worth a real database because each group is a
// read of an existing derivation: the first two must be the bell's own sets, and the third must be
// exactly the lots list's *Won, not yet purchased* filter — a won lot leaving it the moment it is
// settled into a purchase, and a lost or still-open one never entering it.

describe("dashboard: Auctions I bid in (#1812)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let platformId: string;
  let closingLot: string;
  let endedLot: string;
  let wonOld: string;
  let wonNew: string;
  let wonSettled: string;
  let lostLot: string;
  let settledSale: string;

  const inHours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

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

  async function newLot(saleId: string, title: string | null, endsAt: Date): Promise<string> {
    return createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "7",
      url: null,
      title,
      endsAt,
      startingPrice: null,
      currentBid: "10.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });
  }

  async function close(lotId: string, myBid: string, finalPrice: string): Promise<void> {
    await setAuctionLotMyBid(userId, lotId, myBid);
    await recordAuctionLotTransition(userId, lotId, { status: "closed", finalPrice, wonTie: null });
  }

  async function section() {
    const result = await getDashboardSection(userId, collectionId, "auctions");
    return Object.fromEntries(result.groups.map((g) => [g.id, g]));
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-dashauc-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User dashauc-${ts}`,
        email: `test-dashauc-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-dashauc-${ts}`, name: `Collection dashauc-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Heinrich", seller: true } })).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Philasearch" } })).id;

    const running = await newSale("Spring sale");
    closingLot = await newLot(running, "Danzig 1920", inHours(3));
    await newLot(running, "Far off", inHours(24 * 30));
    endedLot = await newLot(running, null, inHours(-2));

    const won = await newSale("Winter sale");
    wonOld = await newLot(won, "Old win", inHours(-72));
    wonNew = await newLot(won, "New win", inHours(-5));
    lostLot = await newLot(won, "Lost one", inHours(-6));
    await close(wonOld, "50.00", "40.00");
    await close(wonNew, "50.00", "45.00");
    await close(lostLot, "20.00", "30.00");

    settledSale = await newSale("Autumn sale");
    wonSettled = await newLot(settledSale, "Settled win", inHours(-96));
    await close(wonSettled, "50.00", "35.00");
    await settleAuctionSale(userId, settledSale, {
      purchasedAt: "2026-10-01",
      shippingCost: null,
      lots: [{ lotId: wonSettled, price: 35 }],
    });
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lays out the three groups in order, empty or not", async () => {
    const result = await getDashboardSection(userId, collectionId, "auctions");
    assert.deepEqual(
      result.groups.map((g) => g.title),
      ["Closing soon", "Waiting to be closed", "Won, not yet purchased"]
    );
  });

  it("holds exactly the bell's sets in the two groups the bell has", async () => {
    const byId = await section();
    const bell = Object.fromEntries((await getActionItems(userId, collectionId)).groups.map((g) => [g.id, g]));
    for (const id of ["auction-closing", "auction-outcome"]) {
      assert.equal(byId[id].count, bell[id].count, `${id}: the count is the bell's`);
      assert.deepEqual(
        byId[id].items.map((i) => i.key),
        bell[id].items.map((i) => i.key),
        `${id}: the rows are the bell's, in its order`
      );
      assert.equal(byId[id].href, bell[id].href, `${id}: and it opens the same list`);
    }
    assert.deepEqual(byId["auction-closing"].items.map((i) => i.key), [closingLot]);
    assert.deepEqual(byId["auction-outcome"].items.map((i) => i.key), [endedLot]);
  });

  it("lists won lots not yet in a purchase, oldest first, and nothing lost, open or settled", async () => {
    const won = (await section())["auction-won-not-purchased"];
    assert.equal(won.count, 2);
    assert.deepEqual(won.items.map((i) => i.key), [wonOld, wonNew]);
    assert.equal(won.href, "auctions?outcome=won&notPurchased=1");
  });

  it("is the lots list's own filter, with or without the outcome beside it", async () => {
    const won = (await section())["auction-won-not-purchased"];
    for (const filters of [{ notPurchased: true }, { outcome: "won" as const, notPurchased: true }]) {
      const list = await listAuctionLots(userId, collectionId, filters);
      assert.deepEqual(list.items.map((l) => l.id), won.items.map((i) => i.key));
      assert.equal(await countAuctionLots(userId, collectionId, filters), won.count);
    }
    // The chip's facet counts the same set, under the hide-closed default it stands in for.
    assert.equal((await auctionLotFilterCounts(userId, collectionId, {})).notPurchased, won.count);
    // A filter it cannot coexist with leaves nothing, rather than being overridden.
    assert.equal(await countAuctionLots(userId, collectionId, { outcome: "pending", notPurchased: true }), 0);
  });

  it("shows each lot with its sale and seller, opening it in its sale", async () => {
    const byId = await section();
    const [row] = byId["auction-closing"].items;
    assert.equal(row.label, "Danzig 1920");
    assert.equal(row.detail, "Spring sale · Heinrich");
    assert.ok(row.at, "the closing instant, formatted as time left on the client");
    const saleId = (await prisma.auctionLot.findUniqueOrThrow({ where: { id: closingLot } })).auctionSaleId;
    assert.equal(row.href, `auctions/sales/${saleId}?lot=${closingLot}`);
    // An untitled lot is called by its number, and its sale is still named beside it.
    const [untitled] = byId["auction-outcome"].items;
    assert.equal(untitled.label, "Lot 7");
    assert.equal(untitled.detail, "Spring sale · Heinrich");
  });

  it("drops a won lot the moment it is settled, and keeps one held back from its parcel", async () => {
    const sale = (await prisma.auctionLot.findUniqueOrThrow({ where: { id: wonNew } })).auctionSaleId;
    await settleAuctionSale(userId, sale, {
      purchasedAt: "2026-10-02",
      shippingCost: null,
      lots: [{ lotId: wonNew, price: 45 }],
    });
    const won = (await section())["auction-won-not-purchased"];
    // A won lot left out of the settlement stays won and unsettled — shipping separately, and still
    // to be bought once it is moved into the sale it arrives with (`auctions.md`).
    assert.equal(won.count, 1);
    assert.deepEqual(won.items.map((i) => i.key), [wonOld]);
  });
});
