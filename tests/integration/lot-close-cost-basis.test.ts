import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";

// Freezes the batched cost-basis writes in `closeLot` (#173): the snapshot loop now
// groups copies by their (2-decimal) cost-basis value and issues one `updateMany` per
// distinct value plus one for the not-delivered set, instead of one `update` per copy.
// A large multi-value lot with a not-delivered copy exercises every branch.

describe("closeLot batches cost-basis writes by value", () => {
  let userId: string;
  let collectionId: string;
  let purchaseId: string;
  let lotId: string;
  // stamp -> the copies (item ids) created against it
  const cheapCopyIds: string[] = [];
  const dearCopyIds: string[] = [];
  let notDeliveredId: string;

  // 12 copies of a cheap stamp + 12 of a dear one → the pool splits into two weight
  // classes, so a correct grouping writes a small, bounded number of distinct values.
  const CHEAP_COPIES = 12;
  const DEAR_COPIES = 12;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-closebasis-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User closebasis-${ts}`,
        email: `test-closebasis-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-closebasis-${ts}`,
        name: `Collection closebasis-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    // Catalog + area so each stamp resolves a primary-catalog price (the allocation weight).
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
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const conditionId = condition.id;

    async function pricedStamp(name: string, price: string) {
      const stamp = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
      });
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: stamp.id,
          catalogEditionId: edition.id,
          conditionId,
          certificateStatusId: null,
          price,
          currency: "EUR",
        },
      });
      return stamp.id;
    }

    const cheapStampId = await pricedStamp("Cheap", "1.00");
    const dearStampId = await pricedStamp("Dear", "9.00");

    // Purchase in the base currency so fxRateToBase is 1 (no exchange-rate fixture needed).
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    purchaseId = purchase.id;

    const lot = await prisma.purchaseLot.create({
      data: { purchaseId, title: "Big lot", price: "120.00", status: "open" },
      select: { id: true },
    });
    lotId = lot.id;

    async function addCopy(stampId: string, deliveryState: string) {
      const item = await prisma.item.create({
        data: { collectionId, stampId, conditionId, lotId, deliveryState },
        select: { id: true },
      });
      return item.id;
    }

    for (let i = 0; i < CHEAP_COPIES; i++) cheapCopyIds.push(await addCopy(cheapStampId, "delivered"));
    for (let i = 0; i < DEAR_COPIES; i++) dearCopyIds.push(await addCopy(dearStampId, "delivered"));
    // One not-delivered copy: it must end with a null (pending) cost-basis.
    notDeliveredId = await addCopy(cheapStampId, "not_delivered");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("freezes every staying copy and leaves not-delivered pending, summing to the pool", async () => {
    const result = await closeLot(userId, lotId);
    assert.deepEqual(result, {
      ok: true,
      snapshotCount: CHEAP_COPIES + DEAR_COPIES,
    });

    const items = await prisma.item.findMany({
      where: { lotId },
      select: { id: true, costBasis: true },
    });
    const basisById = new Map(items.map((i) => [i.id, i.costBasis]));

    // Not-delivered copy stays attached but pending.
    assert.equal(basisById.get(notDeliveredId), null);

    // Every staying copy got a non-null snapshot.
    for (const id of [...cheapCopyIds, ...dearCopyIds]) {
      assert.notEqual(basisById.get(id), null, `copy ${id} should have a cost-basis`);
    }

    // Grouping correctness: copies of the same weight-class collapse to at most a couple of
    // distinct values (apportionment remainder), and cheap copies weigh less than dear ones.
    const cheapValues = new Set(cheapCopyIds.map((id) => basisById.get(id)!.toFixed(2)));
    const dearValues = new Set(dearCopyIds.map((id) => basisById.get(id)!.toFixed(2)));
    assert.ok(cheapValues.size <= 2, `cheap class over-fragmented: ${[...cheapValues]}`);
    assert.ok(dearValues.size <= 2, `dear class over-fragmented: ${[...dearValues]}`);
    const maxCheap = Math.max(...[...cheapValues].map(Number));
    const minDear = Math.min(...[...dearValues].map(Number));
    assert.ok(maxCheap < minDear, "cheap copies should cost less than dear copies");

    // Snapshots sum exactly to the base-currency pool (lot price 120, fx 1, no shared cost).
    const total = [...cheapCopyIds, ...dearCopyIds].reduce(
      (sum, id) => sum + Number(basisById.get(id)),
      0
    );
    assert.equal(total.toFixed(2), "120.00");

    const lotRow = await prisma.purchaseLot.findUnique({
      where: { id: lotId },
      select: { status: true },
    });
    assert.equal(lotRow?.status, "closed");
  });
});
