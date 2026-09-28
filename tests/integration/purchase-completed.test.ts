import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot, intakeStamps, updateLot } from "../../src/lib/lots";
import {
  createPurchase,
  listPurchasesPaginated,
  markPurchaseCompleted,
  reopenCompletedPurchase,
  setPurchaseStatus,
  updatePurchase,
} from "../../src/lib/purchases";

// *Completed* after *Arrived* (#1449): a purchase whose sorting is done. Set by hand and only from
// *Arrived*, moved back to *Arrived* with a bare write, a filter of its own on the Intake documents
// list, and nothing about the order read-only because of it.

describe("a purchase marked Completed (#1449)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;

  async function purchaseWithStatus(status: "preparing" | "in_transit" | "arrived") {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    if (status !== "preparing") await setPurchaseStatus(userId, purchase.id, status);
    return purchase.id;
  }

  async function statusOf(purchaseId: string) {
    const row = await prisma.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      select: { status: true },
    });
    return row.status;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-purchase-completed-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User purchase-completed-${ts}`,
        email: `test-purchase-completed-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-purchase-completed-${ts}`,
        name: `Collection purchase-completed-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test stamp" } });
    stampId = stamp.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("marks an arrived purchase completed, and moves it back to arrived", async () => {
    const purchaseId = await purchaseWithStatus("arrived");
    await markPurchaseCompleted(userId, purchaseId);
    assert.equal(await statusOf(purchaseId), "completed");
    await reopenCompletedPurchase(userId, purchaseId);
    assert.equal(await statusOf(purchaseId), "arrived");
  });

  it("refuses to complete an order that has not arrived", async () => {
    for (const status of ["preparing", "in_transit"] as const) {
      const purchaseId = await purchaseWithStatus(status);
      await assert.rejects(markPurchaseCompleted(userId, purchaseId), /Only an arrived order/);
      assert.equal(await statusOf(purchaseId), status);
    }
  });

  it("moves back only an order that is completed", async () => {
    const purchaseId = await purchaseWithStatus("in_transit");
    await assert.rejects(reopenCompletedPurchase(userId, purchaseId), /not completed/);
    assert.equal(await statusOf(purchaseId), "in_transit");
  });

  it("completes an order with work still left — the screen says what, the domain never refuses", async () => {
    const purchaseId = await purchaseWithStatus("arrived");
    const lotId = await createLot(userId, purchaseId, 10);
    const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: copy.itemId },
      select: { deliveryState: true },
    });
    assert.equal(item.deliveryState, "to_sort");

    await markPurchaseCompleted(userId, purchaseId);
    assert.equal(await statusOf(purchaseId), "completed");
  });

  it("locks nothing: lots are added, re-priced and identified into as before, landing `to_sort`", async () => {
    const purchaseId = await purchaseWithStatus("arrived");
    await markPurchaseCompleted(userId, purchaseId);

    const lotId = await createLot(userId, purchaseId, 10);
    await updateLot(userId, lotId, { price: 12 });
    const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
    // A completed order has arrived: a piece left for later still comes off the desk, not the post.
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: copy.itemId },
      select: { deliveryState: true },
    });
    assert.equal(item.deliveryState, "to_sort");
    assert.equal(await statusOf(purchaseId), "completed");
  });

  it("keeps the status through a header edit that restates it", async () => {
    // The edit dialog and the agent API's `update_purchase` both send the status as it stands;
    // a vocabulary without *Completed* would quietly write `preparing` over it.
    const purchaseId = await purchaseWithStatus("arrived");
    await markPurchaseCompleted(userId, purchaseId);
    await updatePurchase(userId, purchaseId, {
      currency: "EUR",
      purchasedAt: "2026-01-02",
      status: "completed",
    });
    assert.equal(await statusOf(purchaseId), "completed");
  });

  it("files completed orders under their own filter, and takes them out of Arrived", async () => {
    const arrived = await purchaseWithStatus("arrived");
    const completed = await purchaseWithStatus("arrived");
    await markPurchaseCompleted(userId, completed);

    const arrivedIds = (
      await listPurchasesPaginated(userId, collectionId, { status: "arrived", pageSize: 200 })
    ).items.map((p) => p.id);
    const completedIds = (
      await listPurchasesPaginated(userId, collectionId, { status: "completed", pageSize: 200 })
    ).items.map((p) => p.id);

    assert.ok(arrivedIds.includes(arrived));
    assert.ok(!arrivedIds.includes(completed));
    assert.ok(completedIds.includes(completed));
    assert.ok(!completedIds.includes(arrived));
  });

  it("does not apply to an opening balance, which has no delivery status", async () => {
    const doc = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "The shelf",
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    await assert.rejects(markPurchaseCompleted(userId, doc.id), /no delivery status/);
    await assert.rejects(reopenCompletedPurchase(userId, doc.id), /no delivery status/);
    assert.equal(await statusOf(doc.id), "arrived");
  });
});
