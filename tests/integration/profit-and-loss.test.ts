import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createPurchase } from "../../src/lib/purchases";
import { getSaleDetail } from "../../src/lib/sales";
import { getOverviewValue } from "../../src/lib/overview";
import { getProfitAndLoss, listProfitAndLossSales } from "../../src/lib/profit-and-loss";

// The profit and loss screen (#1305), end to end: sales on two platforms across three months, one
// with no exchange rate and one partly countable, and write-offs recorded in their own months —
// and, over the whole scope, the sales total agreeing with the Overview tile and every row with its
// own sale screen.

const TS = Date.now();
const ALL = { from: null, to: null };

describe("profit and loss screen (#1305)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let delcampe: string, allegro: string;
  let conditionId: string;
  let stampId: string;
  let closedLot: string, openLot: string;
  let nextItemNo = 1;
  let nextNo = 1;

  before(async () => {
    for (const id of [`test-user-pnl-${TS}`, `test-user-pnl-x-${TS}`]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    userId = `test-user-pnl-${TS}`;
    strangerId = `test-user-pnl-x-${TS}`;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-pnl-${TS}`, name: "Profit and loss", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    delcampe = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
    allegro = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp" } })).id;

    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2025-01-01",
    });
    closedLot = (
      await prisma.purchaseLot.create({
        data: { purchaseId: purchase.id, price: "100.00", status: "closed" },
      })
    ).id;
    openLot = (
      await prisma.purchaseLot.create({
        data: { purchaseId: purchase.id, price: "100.00", status: "open" },
      })
    ).id;

    // January: a whole sale on Delcampe (30.00 against 10.00) and a loss on Allegro (5.00 against 8.00).
    await sell(delcampe, "2026-01-05", [await copy("10.00")], "30.00");
    await sell(allegro, "2026-01-20", [await copy("8.00")], "5.00");
    // February: a sale whose one copy's cost is still pending — nothing counted on it.
    await sell(delcampe, "2026-02-10", [await copy(null, "open")], "20.00");
    // March: a sale in a currency with no rate — no figure at all.
    await sell(allegro, "2026-03-01", [await copy("3.00")], "9.00", "USD");

    // Write-offs, recorded in January and March; a pending one in March.
    await copy("4.00", "closed", new Date("2026-01-31T22:00:00.000Z"));
    await copy(null, "open", new Date("2026-03-15T12:00:00.000Z"));
    // A copy disposed of **and** sold is the sale's to account for, never a second loss.
    const soldAndGone = await copy("6.00", "closed", new Date("2026-01-10T12:00:00.000Z"));
    await sell(delcampe, "2025-12-20", [soldAndGone], "6.00");
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  async function copy(costBasis: string | null, lot: "open" | "closed" = "closed", disposedAt?: Date) {
    return (
      await prisma.item.create({
        data: {
          collectionId,
          itemNo: nextItemNo++,
          stampId,
          conditionId,
          lotId: lot === "open" ? openLot : closedLot,
          costBasis,
          ...(disposedAt ? { disposedAt, disposalReason: "lost" } : {}),
        },
        select: { id: true },
      })
    ).id;
  }

  async function sell(platformId: string, soldAt: string, itemIds: string[], price: string, currency = "EUR") {
    const no = nextNo++;
    const offer = await prisma.offer.create({
      data: { collectionId, offerNo: no, platformId, currency, price },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: no, platformId, soldAt: new Date(soldAt), currency },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price },
    });
    for (const itemId of itemIds) {
      await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
    }
    return sale.id;
  }

  it("agrees with the Overview tile over the whole collection", async () => {
    const pnl = await getProfitAndLoss(userId, collectionId, ALL, "month");
    const { realized } = await getOverviewValue(userId, collectionId);
    assert.equal(pnl.total.saleCount, realized.saleCount);
    assert.deepEqual(pnl.total.sales, {
      copyCount: realized.copyCount,
      countedCount: realized.countedCount,
      leftOut: realized.leftOut,
      proceeds: realized.proceeds,
      cost: realized.cost,
      profit: realized.profit,
    });
    // 20.00 − 3.00 + 0.00 (Dec) = 17.00 over the counted copies.
    assert.equal(pnl.total.sales.profit, "17.00");
    assert.equal(pnl.total.sales.leftOut.costPending, 1);
    assert.equal(pnl.total.sales.leftOut.noRate, 1);
  });

  it("lists every sale with the figure its own screen shows", async () => {
    const page = await listProfitAndLossSales(userId, collectionId, ALL);
    assert.equal(page.items.length, 5);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(
      page.items.map((row) => row.soldAt.toISOString().slice(0, 10)),
      ["2026-03-01", "2026-02-10", "2026-01-20", "2026-01-05", "2025-12-20"]
    );
    for (const row of page.items) {
      const detail = (await getSaleDetail(userId, row.id))!;
      assert.deepEqual(row.profit, detail.profit);
    }
    assert.equal(page.items[2].platformName, "Allegro");
    assert.equal(page.items[2].profit.profit, "-3.00");
  });

  it("pages the sales in the same order", async () => {
    const first = await listProfitAndLossSales(userId, collectionId, ALL, 0, 2);
    assert.equal(first.items.length, 2);
    assert.equal(first.nextCursor, "2");
    const second = await listProfitAndLossSales(userId, collectionId, ALL, 2, 2);
    const third = await listProfitAndLossSales(userId, collectionId, ALL, 4, 2);
    assert.equal(third.nextCursor, null);
    const all = await listProfitAndLossSales(userId, collectionId, ALL);
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((r) => r.id),
      all.items.map((r) => r.id)
    );
  });

  it("states the write-offs in the months they were recorded, apart from any platform", async () => {
    const pnl = await getProfitAndLoss(userId, collectionId, ALL, "month");
    assert.equal(pnl.total.writeOff.copyCount, 2);
    assert.equal(pnl.total.writeOff.cost, "4.00");
    assert.equal(pnl.total.writeOff.costPending, 1);
    assert.equal(pnl.total.result, "13.00");

    const byKey = new Map(pnl.periods.map((p) => [p.key, p]));
    assert.deepEqual([...byKey.keys()], ["2025-12", "2026-01", "2026-02", "2026-03"]);
    assert.equal(byKey.get("2026-01")!.sales.profit, "17.00");
    assert.equal(byKey.get("2026-01")!.writeOff.cost, "4.00");
    assert.equal(byKey.get("2026-01")!.result, "13.00");
    assert.equal(byKey.get("2026-02")!.sales.profit, null);
    assert.equal(byKey.get("2026-02")!.result, null);
    assert.equal(byKey.get("2026-03")!.writeOff.costPending, 1);
    assert.equal(byKey.get("2026-03")!.result, null);

    assert.deepEqual(
      pnl.platforms.map((p) => [p.platformName, p.saleCount, p.sales.profit]),
      [
        ["Allegro", 2, "-3.00"],
        ["Delcampe", 3, "20.00"],
      ]
    );

    const byYear = await getProfitAndLoss(userId, collectionId, ALL, "year");
    assert.deepEqual(
      byYear.periods.map((p) => [p.key, p.saleCount, p.result]),
      [
        ["2025", 1, "0.00"],
        ["2026", 4, "13.00"],
      ]
    );
  });

  it("narrows sales and write-offs to the chosen dates, both ends inclusive", async () => {
    const range = { from: "2026-01-05", to: "2026-01-31" };
    const pnl = await getProfitAndLoss(userId, collectionId, range, "month");
    assert.equal(pnl.total.saleCount, 2);
    // The write-off recorded late on the 31st is inside the range.
    assert.equal(pnl.total.writeOff.copyCount, 1);
    assert.equal(pnl.total.result, "13.00");
    const page = await listProfitAndLossSales(userId, collectionId, range);
    assert.equal(page.items.length, 2);

    const march = await getProfitAndLoss(userId, collectionId, { from: "2026-03-01", to: null }, "month");
    assert.equal(march.total.saleCount, 1);
    assert.equal(march.total.writeOff.copyCount, 1);
  });

  it("refuses someone else's collection", async () => {
    await assert.rejects(getProfitAndLoss(strangerId, collectionId, ALL, "month"));
    await assert.rejects(listProfitAndLossSales(strangerId, collectionId, ALL));
  });
});
