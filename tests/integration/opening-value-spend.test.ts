import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot, createLot, intakeStamps } from "../../src/lib/lots";
import { createPurchase, getPurchaseReturn } from "../../src/lib/purchases";
import { getHoldingsValuation, getPurchaseIntakeSummary } from "../../src/lib/items";
import { getItemSaleRecord, getSaleDetail } from "../../src/lib/sales";
import { getOverviewValue } from "../../src/lib/overview";
import { getStampPurchaseCosts } from "../../src/lib/purchase-costs";

// An opening value counts towards profit and loss, never as money spent (#1324). An opening balance
// (#1323) is a purchase order underneath, so every figure meaning *money spent* or *a price paid*
// would read its opening value as one. What is pinned here, end to end through the real intake and
// close: a sale measures profit against an opening-value share and says why there is none without a
// value; and the spent figures — the holdings' purchase cost, the Overview's purchase ROI, and the
// Valuation dialog's purchase-price statistics — are the same before and after a valued opening
// balance is added.

const TS = Date.now();

describe("opening value: profit and loss, never spend (#1324)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;
  let stampId: string;
  let nextNo = 1;

  before(async () => {
    userId = `test-user-openingspend-${TS}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-openingspend-${TS}`, name: "Opening spend", baseCurrency: "EUR", ownerId: userId },
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
      data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
    });
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Priced" } })).id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: edition.id,
        conditionId,
        certificateStatusId: null,
        price: "2.00",
        currency: "EUR",
      },
    });
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** A closed lot of `copies` copies of the priced stamp, on a new document of the given kind. */
  async function closedLot(kind: "purchase" | "opening_balance", price: number | null, copies = 1) {
    const doc =
      kind === "purchase"
        ? await createPurchase(userId, collectionId, {
            purchasedAt: "2026-09-01",
            currency: "EUR",
            status: "arrived",
          })
        : await createPurchase(userId, collectionId, {
            kind: "opening_balance",
            title: `Opening ${nextNo++}`,
            purchasedAt: "2026-09-01",
            currency: "EUR",
          });
    const lotId = await createLot(userId, doc.id, price, null);
    const itemIds: string[] = [];
    for (let i = 0; i < copies; i++) {
      const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
      itemIds.push(copy.itemId);
    }
    const closed = await closeLot(userId, lotId);
    assert.equal(closed.ok, true);
    return { purchaseId: doc.id, lotId, itemIds };
  }

  /** One sale of one unit carrying the given copy. */
  async function sell(itemId: string, price: string) {
    const no = nextNo++;
    const offer = await prisma.offer.create({
      data: { collectionId, offerNo: no, platformId, currency: "EUR", price },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: no, platformId, soldAt: new Date("2026-09-10"), currency: "EUR" },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
    return sale.id;
  }

  /** Every figure in the app that means money spent or a price paid, as one comparable value. */
  async function spentFigures() {
    const [holdings, overview, stampCosts] = await Promise.all([
      getHoldingsValuation(userId, collectionId, { excludeGone: true }),
      getOverviewValue(userId, collectionId),
      getStampPurchaseCosts(userId, stampId),
    ]);
    return {
      purchaseCost: holdings.cost,
      recoup: {
        measured: overview.purchases.measured,
        spent: overview.purchases.spent,
        realized: overview.purchases.realized,
        uncosted: overview.purchases.uncosted,
      },
      stampCosts,
    };
  }

  it("leaves every spent figure unchanged when a valued opening balance is added", async () => {
    // A real purchase first, so the figures being compared are not all empty.
    await closedLot("purchase", 6, 2);
    const before = await spentFigures();
    assert.equal(before.purchaseCost.totalCostBasis, "6.00");
    assert.equal(before.recoup.measured, 1);
    assert.equal(before.stampCosts.knownCount, 2);

    await closedLot("opening_balance", 100, 2);
    await closedLot("opening_balance", null, 1);
    const after = await spentFigures();
    assert.deepEqual(after, before);

    // …and the opening value is still stated, apart, with the copy that has none counted.
    const holdings = await getHoldingsValuation(userId, collectionId, { excludeGone: true });
    assert.equal(holdings.openingValue.totalCostBasis, "100.00");
    assert.equal(holdings.openingValue.knownCount, 2);
    assert.equal(holdings.openingValue.noneCount, 1);
  });

  it("splits an opening balance's own summary into opening value, with no purchase cost", async () => {
    const { purchaseId } = await closedLot("opening_balance", 30, 3);
    const summary = await getPurchaseIntakeSummary(userId, collectionId, purchaseId);
    assert.equal(summary.holdings.openingValue.totalCostBasis, "30.00");
    assert.equal(summary.holdings.openingValue.knownCount, 3);
    assert.equal(summary.holdings.cost.knownCount + summary.holdings.cost.noneCount, 0);
  });

  it("measures profit on sale against the opening-value share", async () => {
    // 40.00 over two equally priced copies: 20.00 each.
    const { purchaseId, itemIds } = await closedLot("opening_balance", 40, 2);
    const saleId = await sell(itemIds[0], "50.00");

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.profit.cost, "20.00");
    assert.equal(detail.profit.profit, "30.00");

    const record = (await getItemSaleRecord(userId, itemIds[0]))!;
    assert.deepEqual(record.profit.cost, { state: "known", amount: "20.00" });
    assert.equal(record.profit.profit, "30.00");

    // The document's own return runs against its opening value, and names it so.
    const ret = await getPurchaseReturn(userId, purchaseId);
    assert.equal(ret.basis, "opening_value");
    assert.equal(ret.soldMargin, "30.00");
  });

  it("gives no profit for a copy from a lot without a value, and says why", async () => {
    const { itemIds } = await closedLot("opening_balance", null, 1);
    const saleId = await sell(itemIds[0], "50.00");

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.profit.profit, null);
    assert.equal(detail.profit.leftOut.noOpeningValue, 1);
    assert.equal(detail.profit.leftOut.noCost, 0);

    const record = (await getItemSaleRecord(userId, itemIds[0]))!;
    assert.deepEqual(record.profit.cost, { state: "none", reason: "no_opening_value" });
    assert.equal(record.profit.profit, null);

    // The Overview's realized figure is the same sales added up: the copy stays counted apart.
    const overview = await getOverviewValue(userId, collectionId);
    assert.ok(overview.realized.leftOut.noOpeningValue >= 1);
  });
});
