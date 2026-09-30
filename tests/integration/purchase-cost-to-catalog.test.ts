import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot, createLot, getPurchaseDetail, intakeStamps } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { getLotIntakeSummary, getPurchaseIntakeSummary } from "../../src/lib/items";
import {
  costPercent,
  formatCostPercent,
  lotCostToCatalog,
  orderCostToCatalog,
  type CostToCatalogLot,
  type LotCatalogBasis,
} from "../../src/lib/cost-to-catalog";
import type { LotSummary } from "../../src/lib/lots";

// What an order, and each of its lots, cost as a share of catalogue (#1395), read back out of Prisma.
// The arithmetic has its own unit test (`tests/unit/cost-to-catalog.test.ts`); what this one covers is
// the gathering — which copies each lot's basis is taken over, that the frozen side is the close's own
// snapshot, and that the two summaries agree — and the three lots the figure has to keep apart:
//
//  - **closed**, priced throughout, with a not-delivered copy whose share went to the others;
//  - **open and partly priced**, whose figure is only an upper bound and makes the order's one too
//    (#1510);
//  - **open and unpriced**, which has no figure at all.
//
// A second order holds only partly priced open lots — an order being sorted — whose figure is then
// wholly an upper bound (#1510).

const TS = Date.now();

describe("purchase cost as a share of catalogue (#1395)", () => {
  let userId: string;
  let collectionId: string;
  let purchaseId: string;
  let closedLotId: string;
  let partLotId: string;
  let unpricedLotId: string;
  let sortingPurchaseId: string;

  before(async () => {
    userId = `test-user-costcat-${TS}`;
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
        data: { slug: `col-costcat-${TS}`, name: "Cost to catalog", baseCurrency: "EUR", ownerId: userId },
      })
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
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const pricedStampId = (await prisma.stamp.create({ data: { collectionId, name: "Priced" } })).id;
    const unpricedStampId = (await prisma.stamp.create({ data: { collectionId, name: "Unpriced" } }))
      .id;
    for (const stampId of [pricedStampId, unpricedStampId]) {
      await prisma.stampCollectionArea.create({
        data: { stampId, collectionAreaId: area.id, isPrimary: true },
      });
    }
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: pricedStampId,
        catalogEditionId: edition.id,
        conditionId,
        certificateStatusId: null,
        price: "2.00",
        currency: "EUR",
      },
    });

    purchaseId = (
      await createPurchase(userId, collectionId, {
        purchasedAt: "2026-09-01",
        currency: "EUR",
        status: "arrived",
      })
    ).id;

    const intake = async (lotId: string, stampId: string) =>
      (await intakeStamps(userId, { lotId }, { stampId, conditionId }))[0].itemId;

    // Closed: 10 EUR over two priced copies (2 EUR each); a third never arrived, so its share went to
    // the other two and it is out of both sides.
    closedLotId = await createLot(userId, purchaseId, 10, null);
    await intake(closedLotId, pricedStampId);
    await intake(closedLotId, pricedStampId);
    const lost = await intake(closedLotId, pricedStampId);
    await prisma.item.update({ where: { id: lost }, data: { deliveryState: "not_delivered" } });
    assert.equal((await closeLot(userId, closedLotId)).ok, true);

    // Open, one copy priced at 2 EUR and one not: 3 EUR against 2 EUR is at most 150%.
    partLotId = await createLot(userId, purchaseId, 3, null);
    await intake(partLotId, pricedStampId);
    await intake(partLotId, unpricedStampId);

    // Open and nothing priced: no figure.
    unpricedLotId = await createLot(userId, purchaseId, 4, null);
    await intake(unpricedLotId, unpricedStampId);

    // Being sorted: two open lots, each partly priced — 1 EUR against 2 EUR, and 2 EUR against 4 EUR.
    sortingPurchaseId = (
      await createPurchase(userId, collectionId, {
        purchasedAt: "2026-09-02",
        currency: "EUR",
        status: "arrived",
      })
    ).id;
    const firstSortingLotId = await createLot(userId, sortingPurchaseId, 1, null);
    await intake(firstSortingLotId, pricedStampId);
    await intake(firstSortingLotId, unpricedStampId);
    const secondSortingLotId = await createLot(userId, sortingPurchaseId, 2, null);
    await intake(secondSortingLotId, pricedStampId);
    await intake(secondSortingLotId, pricedStampId);
    await intake(secondSortingLotId, unpricedStampId);
    await intake(secondSortingLotId, unpricedStampId);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** The screen's own reading: the lot's state and pool off the purchase read model, beside the
   * basis the summary gathered. */
  async function lotsWith(
    bases: Record<string, LotCatalogBasis>,
    ofPurchaseId = purchaseId
  ): Promise<CostToCatalogLot[]> {
    const detail = await getPurchaseDetail(userId, ofPurchaseId);
    assert.ok(detail);
    return detail.lots.map((l: LotSummary) => ({
      open: l.status === "open",
      valued: l.price != null,
      poolBase: l.poolBase != null ? Number(l.poolBase) : null,
      basis: bases[l.id],
    }));
  }

  it("gathers a closed lot over its frozen snapshots, leaving the copy that never arrived out", async () => {
    const summary = await getLotIntakeSummary(userId, collectionId, closedLotId);
    assert.deepEqual(summary.catalogBasis, {
      copyCount: 2,
      unpricedCount: 0,
      pricedValue: 4,
      frozenCount: 2,
      frozenCost: 10,
      frozenValue: 4,
    });
    const [lot] = (await lotsWith({ [closedLotId]: summary.catalogBasis })).filter(
      (l) => !l.open
    );
    const r = lotCostToCatalog(lot);
    assert.equal(r?.kind, "settled");
    assert.equal(formatCostPercent(costPercent(r!)), "250%");
  });

  it("states a partly priced open lot as an upper bound over its priced copies", async () => {
    const summary = await getLotIntakeSummary(userId, collectionId, partLotId);
    assert.equal(summary.catalogBasis.copyCount, 2);
    assert.equal(summary.catalogBasis.unpricedCount, 1);
    assert.equal(summary.catalogBasis.pricedValue, 2);
    const detail = await getPurchaseDetail(userId, purchaseId);
    const lot = detail!.lots.find((l) => l.id === partLotId)!;
    const r = lotCostToCatalog({
      open: true,
      valued: true,
      poolBase: Number(lot.poolBase),
      basis: summary.catalogBasis,
    });
    assert.equal(r?.kind, "at_most");
    assert.equal(formatCostPercent(costPercent(r!)), "150%");
  });

  it("gives an unpriced lot no figure at all", async () => {
    const summary = await getLotIntakeSummary(userId, collectionId, unpricedLotId);
    assert.equal(summary.catalogBasis.pricedValue, 0);
    const detail = await getPurchaseDetail(userId, purchaseId);
    const lot = detail!.lots.find((l) => l.id === unpricedLotId)!;
    assert.equal(
      lotCostToCatalog({
        open: true,
        valued: true,
        poolBase: Number(lot.poolBase),
        basis: summary.catalogBasis,
      }),
      null
    );
  });

  it("reads the order over every lot with a figure, as an upper bound, and counts the copies it leaves out", async () => {
    const summary = await getPurchaseIntakeSummary(userId, collectionId, purchaseId);
    // The order's summary gathers each lot exactly as the lot's own does.
    for (const lotId of [closedLotId, partLotId, unpricedLotId]) {
      const own = await getLotIntakeSummary(userId, collectionId, lotId);
      assert.deepEqual(summary.lotCatalogBasis[lotId], own.catalogBasis);
    }
    // The closed lot's 10 against 4 and the partly priced one's 3 against 2; the unpriced lot is out.
    const r = orderCostToCatalog(await lotsWith(summary.lotCatalogBasis));
    assert.equal(r?.kind, "at_most");
    assert.equal(r?.cost, 13);
    assert.equal(r?.value, 6);
    assert.equal(formatCostPercent(costPercent(r!)), "217%");
    assert.equal(r?.coveredCount, 3);
    assert.equal(r?.copyCount, 5);
    assert.equal(r?.unpricedCount, 2);
    assert.equal(r?.noFigureCount, 1);
  });

  it("states an order whose lots are all upper bounds as one, over the order's unpriced copies", async () => {
    const summary = await getPurchaseIntakeSummary(userId, collectionId, sortingPurchaseId);
    const r = orderCostToCatalog(await lotsWith(summary.lotCatalogBasis, sortingPurchaseId));
    assert.equal(r?.kind, "at_most");
    assert.equal(r?.cost, 3);
    assert.equal(r?.value, 6);
    assert.equal(formatCostPercent(costPercent(r!)), "50%");
    assert.equal(r?.coveredCount, 3);
    assert.equal(r?.copyCount, 6);
    assert.equal(r?.unpricedCount, 3);
    assert.equal(r?.noFigureCount, 0);
  });

  it("is whole-order whatever the list is filtered to", async () => {
    const filtered = await getPurchaseIntakeSummary(userId, collectionId, purchaseId, {
      lotState: "closed",
    });
    const whole = await getPurchaseIntakeSummary(userId, collectionId, purchaseId);
    assert.deepEqual(filtered.lotCatalogBasis, whole.lotCatalogBasis);
  });
});
