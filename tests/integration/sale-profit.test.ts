import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createPurchase } from "../../src/lib/purchases";
import { getItemSaleRecord, getSaleDetail } from "../../src/lib/sales";
import { getOverviewValue } from "../../src/lib/overview";

// Profit and loss on the sale screen, the copy page and the Overview (#168), end to end: a sale
// that counts whole, one partly countable through a catalogue split, one with no exchange rate and
// one whose uncountable unit cannot be split — and, over all four, the sale screens adding up to
// exactly the Overview's realized figure. Last, a copy on a still-open lot counted at its estimated
// cost on the sale screen (#1814), and at its frozen cost once the lot closes; and a copy with no
// cost at all counted at none on the sale screen, named, until its cost is set (#1875).
//
// Cost bases are written directly, as `purchase-return.test.ts` does: freezing them is #121's.

const TS = Date.now();

describe("sale profit and loss (#168)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;
  let cheap: string, dear: string, unpriced: string;
  let closedLot: string, openLot: string, openLotNoRate: string;
  const saleIds: string[] = [];
  let nextItemNo = 1;
  let nextNo = 1;

  before(async () => {
    for (const id of [`test-user-saleprofit-${TS}`, `test-user-saleprofit-x-${TS}`]) {
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
    userId = `test-user-saleprofit-${TS}`;
    strangerId = `test-user-saleprofit-x-${TS}`;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-saleprofit-${TS}`, name: "Sale profit", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2024 },
    });
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    async function stamp(name: string, price: string | null) {
      const row = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: row.id, collectionAreaId: area.id, isPrimary: true },
      });
      if (price != null) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: row.id,
            catalogEditionId: edition.id,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "EUR",
          },
        });
      }
      return row.id;
    }
    cheap = await stamp("Cheap", "1.00");
    dear = await stamp("Dear", "3.00");
    unpriced = await stamp("Unpriced", null);

    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
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
    // An open lot whose cost cannot be estimated: bought in another currency with no rate (#1814).
    const foreign = await createPurchase(userId, collectionId, {
      currency: "USD",
      purchasedAt: "2026-01-01",
    });
    await prisma.purchase.update({ where: { id: foreign.id }, data: { fxRateToBase: null } });
    openLotNoRate = (
      await prisma.purchaseLot.create({
        data: { purchaseId: foreign.id, price: "100.00", status: "open" },
      })
    ).id;
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

  async function copy(stampId: string, cost: { lotId: string | null; costBasis: string | null }) {
    return (
      await prisma.item.create({
        data: { collectionId, itemNo: nextItemNo++, stampId, conditionId, ...cost },
        select: { id: true },
      })
    ).id;
  }
  // Functions, not values: the lots exist only once `before` has run.
  const costing = (costBasis: string) => ({ lotId: closedLot, costBasis });
  const pendingCost = () => ({ lotId: openLotNoRate, costBasis: null });
  const noCost = { lotId: null, costBasis: null };

  /** One sale of one unit carrying the given copies. */
  async function sell(
    itemIds: string[],
    price: string,
    extra: { currency?: string; commission?: string; shippingCost?: string } = {}
  ) {
    const no = nextNo++;
    const currency = extra.currency ?? "EUR";
    const offer = await prisma.offer.create({
      data: { collectionId, offerNo: no, platformId, currency, price },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: {
        collectionId,
        saleNo: no,
        platformId,
        soldAt: new Date("2026-03-01"),
        currency,
        commission: extra.commission ?? null,
        shippingCost: extra.shippingCost ?? null,
        shippingCurrency: extra.shippingCost ? "EUR" : null,
      },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price },
    });
    for (const itemId of itemIds) {
      await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
    }
    saleIds.push(sale.id);
    return sale.id;
  }

  it("states a wholly countable sale's cost and profit, and each unit's own", async () => {
    // 60.00 − 10.00 commission − 5.00 shipping = 45.00 net, against two copies at 10.00.
    const a = await copy(cheap, costing("10.00"));
    const b = await copy(unpriced, costing("10.00"));
    const saleId = await sell([a, b], "60.00", { commission: "10.00", shippingCost: "5.00" });

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.netProceeds, "45.00");
    assert.deepEqual(detail.profit, {
      copyCount: 2,
      countedCount: 2,
      leftOut: { costPending: 0, noCost: 0, noOpeningValue: 0, noRate: 0, unsplittable: 0 },
      proceeds: "45.00",
      cost: "20.00",
      profit: "25.00",
      estimatedCount: 0,
      withoutCostIds: [],
    });
    assert.deepEqual(detail.copiesWithoutCost, []);
    assert.equal(detail.lines[0].profit.profit, "25.00");
    assert.equal(detail.lines[0].profit.cost, "20.00");

    // An unpriced copy on the unit cannot be split out, but the unit's own figure never needed it.
    const record = (await getItemSaleRecord(userId, a))!;
    assert.equal(record.profit.shareGap, "unsplittable");
    assert.equal(record.profit.profit, null);
  });

  it("counts a partly countable sale over its known copy, and marks the rest pending", async () => {
    // The pending copy's lot has no rate to EUR, so it has no estimate either (#1814).
    // 100.00 split 1:3 by catalogue price — the known copy takes 25.00 against 10.00.
    const known = await copy(cheap, costing("10.00"));
    const waiting = await copy(dear, pendingCost());
    const saleId = await sell([known, waiting], "100.00");

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.profit.copyCount, 2);
    assert.equal(detail.profit.countedCount, 1);
    assert.equal(detail.profit.leftOut.costPending, 1);
    assert.equal(detail.profit.proceeds, "25.00");
    assert.equal(detail.profit.profit, "15.00");
    assert.equal(detail.lines[0].profit.profit, null);
    assert.equal(detail.lines[0].profit.leftOut.costPending, 1);

    const mine = (await getItemSaleRecord(userId, known))!;
    assert.equal(mine.baseCurrency, "EUR");
    assert.equal(mine.profit.share, "25.00");
    assert.deepEqual(mine.profit.cost, { state: "known", amount: "10.00" });
    assert.equal(mine.profit.profit, "15.00");

    const theirs = (await getItemSaleRecord(userId, waiting))!;
    assert.equal(theirs.profit.share, "75.00");
    assert.deepEqual(theirs.profit.cost, { state: "pending" });
    assert.equal(theirs.profit.profit, null);
  });

  it("gives a sale with no exchange rate no figure at all", async () => {
    const e = await copy(cheap, costing("5.00"));
    const saleId = await sell([e], "20.00", { currency: "USD" });

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.profit.profit, null);
    assert.equal(detail.profit.proceeds, null);
    assert.equal(detail.profit.leftOut.noRate, 1);
    assert.equal(detail.lines[0].profit.leftOut.noRate, 1);

    const record = (await getItemSaleRecord(userId, e))!;
    assert.equal(record.profit.shareGap, "no-rate");
    assert.equal(record.profit.share, null);
  });

  it("counts a copy with no cost at none on the sale screen, where the realized figure leaves it out (#1875)", async () => {
    // Without the option the unit's net cannot be split away from the uncosted, unpriced copy, so
    // the realized figure leaves both out; the sale screen states the unit over the known cost.
    const f = await copy(cheap, costing("10.00"));
    const g = await copy(unpriced, noCost);
    const saleId = await sell([f, g], "50.00");

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.profit.profit, "40.00");
    assert.equal(detail.profit.cost, "10.00");
    assert.equal(detail.profit.countedCount, 2);
    assert.deepEqual(detail.profit.withoutCostIds, [g]);
    assert.equal(detail.lines[0].profit.profit, "40.00");
    assert.deepEqual(detail.lines[0].copiesWithoutCost.map((c) => c.itemId), [g]);
    assert.ok(detail.lines[0].copiesWithoutCost[0].label.length > 0);
    assert.deepEqual(detail.copiesWithoutCost, detail.lines[0].copiesWithoutCost);
  });

  it("adds the sale screens up to exactly the Overview's realized figure", async () => {
    let copies = 0;
    let counted = 0;
    let proceeds = 0;
    let cost = 0;
    let profit = 0;
    const leftOut = { costPending: 0, noCost: 0, noOpeningValue: 0, noRate: 0, unsplittable: 0 };
    for (const saleId of saleIds) {
      const { profit: p, copiesWithoutCost } = (await getSaleDetail(userId, saleId))!;
      if (copiesWithoutCost.length > 0) {
        // The sale screen counts a copy with no cost at none (#1875); the realized figure leaves
        // it out — here, the fourth case's unit: its uncosted copy, and its known one unsplittable.
        copies += p.copyCount;
        leftOut.noCost += 1;
        leftOut.unsplittable += 1;
        continue;
      }
      copies += p.copyCount;
      counted += p.countedCount;
      if (p.proceeds != null) proceeds += Math.round(Number(p.proceeds) * 100);
      if (p.cost != null) cost += Math.round(Number(p.cost) * 100);
      if (p.profit != null) profit += Math.round(Number(p.profit) * 100);
      for (const key of Object.keys(leftOut) as (keyof typeof leftOut)[]) leftOut[key] += p.leftOut[key];
    }

    const { realized } = await getOverviewValue(userId, collectionId);
    assert.equal(realized.saleCount, 4);
    assert.equal(realized.copyCount, copies);
    assert.equal(realized.countedCount, counted);
    assert.deepEqual(realized.leftOut, leftOut);
    assert.equal(realized.proceeds, (proceeds / 100).toFixed(2));
    assert.equal(realized.cost, (cost / 100).toFixed(2));
    assert.equal(realized.profit, (profit / 100).toFixed(2));
    // …and those are the figures the four cases above state.
    assert.equal(realized.profit, "40.00");
    assert.equal(realized.copyCount, 7);
    assert.equal(realized.countedCount, 3);
  });

  it("says nothing of a copy still held, and refuses someone else's", async () => {
    const held = await copy(cheap, costing("1.00"));
    assert.equal(await getItemSaleRecord(userId, held), null);
    const sold = await copy(cheap, costing("1.00"));
    await sell([sold], "2.00");
    await assert.rejects(getItemSaleRecord(strangerId, sold));
  });

  it("counts a copy on an open lot at its estimate, marked, and at its frozen cost once closed (#1814)", async () => {
    // The open lot's 100.00 is shared 3:1 by catalogue value: the Dear copy is estimated at 75.00.
    const known = await copy(cheap, costing("10.00"));
    const waiting = await copy(dear, { lotId: openLot, costBasis: null });
    await copy(cheap, { lotId: openLot, costBasis: null });
    const { realized: before } = await getOverviewValue(userId, collectionId);
    const saleId = await sell([known, waiting], "150.00");

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.profit.countedCount, 2);
    assert.equal(detail.profit.estimatedCount, 1);
    assert.equal(detail.profit.leftOut.costPending, 0);
    assert.equal(detail.profit.cost, "85.00");
    assert.equal(detail.profit.profit, "65.00");
    assert.equal(detail.lines[0].profit.profit, "65.00");
    assert.equal(detail.lines[0].profit.estimatedCount, 1);

    // The Overview's realized figure keeps the copy pending.
    const { realized: after } = await getOverviewValue(userId, collectionId);
    assert.equal(after.leftOut.costPending, before.leftOut.costPending + 1);
    assert.equal(after.countedCount, before.countedCount + 1);

    // The lot closes and freezes its own figure: the line states it, no longer an estimate.
    await prisma.item.update({ where: { id: waiting }, data: { costBasis: "80.00" } });
    await prisma.purchaseLot.update({ where: { id: openLot }, data: { status: "closed" } });
    const settled = (await getSaleDetail(userId, saleId))!;
    assert.equal(settled.profit.estimatedCount, 0);
    assert.equal(settled.profit.cost, "90.00");
    assert.equal(settled.profit.profit, "60.00");
    assert.equal(settled.lines[0].profit.estimatedCount, 0);
    assert.equal(settled.lines[0].profit.profit, "60.00");
  });

  it("names a copy lacking any cost on its line until the cost is set, then states a plain profit (#1875)", async () => {
    // 45.00 net over three copies, one with no cost: 45.00 − 16.60 known = 28.40, marked incomplete.
    const a = await copy(cheap, costing("10.00"));
    const b = await copy(cheap, noCost);
    const c = await copy(cheap, costing("6.60"));
    const saleId = await sell([a, b, c], "45.00");

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.lines[0].profit.profit, "28.40");
    assert.equal(detail.lines[0].profit.cost, "16.60");
    assert.deepEqual(detail.lines[0].copiesWithoutCost.map((r) => r.itemId), [b]);
    assert.deepEqual(detail.copiesWithoutCost.map((r) => r.itemId), [b]);
    assert.equal(detail.profit.profit, "28.40");
    assert.equal(detail.profit.countedCount, 3);

    await prisma.item.update({ where: { id: b }, data: { costBasis: "3.40" } });
    const settled = (await getSaleDetail(userId, saleId))!;
    assert.deepEqual(settled.lines[0].copiesWithoutCost, []);
    assert.deepEqual(settled.copiesWithoutCost, []);
    assert.equal(settled.lines[0].profit.profit, "25.00");
    assert.equal(settled.profit.profit, "25.00");
  });
});
