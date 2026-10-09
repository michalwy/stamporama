import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot, createLot, getPurchaseDetail, intakeStamps } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { getItemListItem, getLotIntakeSummary, listItemsPaginated } from "../../src/lib/items";
import { getStampPurchaseCosts } from "../../src/lib/purchase-costs";
import { estimateCopyCost } from "../../src/lib/purchase-allocation";

// What a copy on a still-open lot is estimated to cost, read for the screens outside its purchase
// order (#1696): the copy's own page and the copies list (`ItemListItem.costEstimate`), and the
// Valuation dialog's *What I paid*. The arithmetic has its unit test; what this covers is that the
// figure read here is **the purchase order's own** — its pool off the purchase detail, its
// denominator off the lot summary — and that the gaps and the frozen side stay apart.
//
// One order, 4 EUR shipping over two lots by price (9 : 3 → 3 : 1):
//  - **open**, pool 12: a 2 EUR copy (→ 4.00), a 4 EUR copy (→ 8.00), an unpriced copy (no
//    catalogue value) and a 2 EUR copy that never arrived (out of the split);
//  - **closed**, pool 4: a 2 EUR and a 4 EUR copy, frozen at 1.33 and 2.67.

const TS = Date.now();

describe("an open lot's copy shows its estimated cost (#1696)", () => {
  let userId: string;
  let collectionId: string;
  let purchaseId: string;
  let openLotId: string;
  let cheapStampId: string;
  let cheapId: string;
  let dearId: string;
  let unpricedId: string;
  let lostId: string;
  let closedCheapId: string;

  before(async () => {
    userId = `test-user-costest-${TS}`;
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
        data: { slug: `col-costest-${TS}`, name: "Cost estimate", baseCurrency: "EUR", ownerId: userId },
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
    const stamp = async (name: string, price: string | null) => {
      const id = (await prisma.stamp.create({ data: { collectionId, name } })).id;
      await prisma.stampCollectionArea.create({
        data: { stampId: id, collectionAreaId: area.id, isPrimary: true },
      });
      if (price) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: id,
            catalogEditionId: edition.id,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "EUR",
          },
        });
      }
      return id;
    };
    cheapStampId = await stamp("Cheap", "2.00");
    const dearStampId = await stamp("Dear", "4.00");
    const unpricedStampId = await stamp("Unpriced", null);

    purchaseId = (
      await createPurchase(userId, collectionId, {
        purchasedAt: "2026-09-01",
        currency: "EUR",
        shippingCost: 4,
        status: "arrived",
      })
    ).id;
    const intake = async (lotId: string, stampId: string) =>
      (await intakeStamps(userId, { lotId }, { stampId, conditionId }))[0].itemId;

    openLotId = await createLot(userId, purchaseId, 9, null);
    cheapId = await intake(openLotId, cheapStampId);
    dearId = await intake(openLotId, dearStampId);
    unpricedId = await intake(openLotId, unpricedStampId);
    lostId = await intake(openLotId, cheapStampId);
    await prisma.item.update({ where: { id: lostId }, data: { deliveryState: "not_delivered" } });

    const closedLotId = await createLot(userId, purchaseId, 3, null);
    closedCheapId = await intake(closedLotId, cheapStampId);
    await intake(closedLotId, dearStampId);
    assert.equal((await closeLot(userId, closedLotId)).ok, true);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function listed(ids: string[]) {
    const { items } = await listItemsPaginated(userId, collectionId, { ids, pageSize: ids.length });
    return new Map(items.map((i) => [i.id, i]));
  }

  it("is the figure the purchase order shows for the same copy", async () => {
    // The purchase order's own reading: the lot's pool off the detail, its denominator off the
    // summary, and each copy's weight off its row.
    const detail = await getPurchaseDetail(userId, purchaseId);
    const lot = detail!.lots.find((l) => l.id === openLotId)!;
    assert.equal(lot.poolBase, "12.00");
    const summary = await getLotIntakeSummary(userId, collectionId, openLotId);
    assert.equal(summary.estimateWeightBase, 6);

    const items = await listed([cheapId, dearId]);
    for (const id of [cheapId, dearId]) {
      const item = items.get(id)!;
      const order: number | null = estimateCopyCost(
        { deliveryState: item.deliveryState, weight: item.value.baseAmount },
        Number(lot.poolBase),
        summary.estimateWeightBase
      ).amount;
      assert.equal(item.costEstimate, order!.toFixed(2));
    }
    assert.equal(items.get(cheapId)!.costEstimate, "4.00");
    assert.equal(items.get(dearId)!.costEstimate, "8.00");
    assert.equal(items.get(cheapId)!.costBasis, null);
  });

  it("reaches the copy's own page", async () => {
    const item = await getItemListItem(userId, dearId);
    assert.equal(item.costEstimate, "8.00");
    assert.equal(item.costEstimateGap, null);
  });

  it("says why a pending copy has none", async () => {
    const items = await listed([unpricedId, lostId]);
    assert.equal(items.get(unpricedId)!.costEstimate, null);
    assert.equal(items.get(unpricedId)!.costEstimateGap, "no_catalog_value");
    assert.equal(items.get(lostId)!.costEstimate, null);
    assert.equal(items.get(lostId)!.costEstimateGap, "not_delivered");
  });

  it("is absent once the cost basis is frozen", async () => {
    const item = (await listed([closedCheapId])).get(closedCheapId)!;
    assert.equal(item.costBasis, "1.33");
    assert.equal(item.costEstimate, null);
    assert.equal(item.costEstimateGap, null);
  });

  it("sits beside What I paid's pending count, never in its average", async () => {
    const costs = await getStampPurchaseCosts(userId, cheapStampId);
    assert.equal(costs.cells.length, 1);
    const [cell] = costs.cells;
    // The frozen 1.33 alone is the average; the open lot's 4.00 is the pending estimate. The copy
    // that never arrived is not held, so it is in neither.
    assert.equal(cell.average, "1.33");
    assert.equal(cell.knownCount, 1);
    assert.equal(cell.pendingCount, 1);
    assert.equal(cell.pendingEstimate, "4.00");
    assert.equal(cell.pendingEstimatedCount, 1);
  });
});
