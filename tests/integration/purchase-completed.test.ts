import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot, intakeStamps, markPurchaseArrived, updateLot } from "../../src/lib/lots";
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
// list, and nothing about the order read-only because of it. An opening balance is marked the same
// way (#1461), without gaining a delivery status.

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

  describe("an opening balance marked completed (#1461)", () => {
    async function openingBalance(title: string) {
      const doc = await createPurchase(userId, collectionId, {
        kind: "opening_balance",
        title,
        currency: "EUR",
        purchasedAt: "2026-01-01",
      });
      return doc.id;
    }

    it("is marked completed and moved back in progress through the purchase's own doors", async () => {
      const docId = await openingBalance("The shelf");
      assert.equal(await statusOf(docId), "arrived");
      await markPurchaseCompleted(userId, docId);
      assert.equal(await statusOf(docId), "completed");
      await assert.rejects(markPurchaseCompleted(userId, docId), /Only an arrived order/);
      await reopenCompletedPurchase(userId, docId);
      assert.equal(await statusOf(docId), "arrived");
      await assert.rejects(reopenCompletedPurchase(userId, docId), /not completed/);
    });

    it("gains no delivery status, in the domain or the database", async () => {
      const docId = await openingBalance("No post");
      await markPurchaseCompleted(userId, docId);
      await assert.rejects(setPurchaseStatus(userId, docId, "in_transit"), /no delivery status/);
      await assert.rejects(markPurchaseArrived(userId, docId), /no delivery status/);
      for (const status of ["preparing", "in_transit"]) {
        await assert.rejects(
          prisma.purchase.update({ where: { id: docId }, data: { status } }),
          /purchase_kind_shape/
        );
      }
      assert.equal(await statusOf(docId), "completed");
    });

    it("keeps its mark through a header edit, whatever status the form sent", async () => {
      // Its header has no status field: an edit that wrote one back would reopen it silently.
      const docId = await openingBalance("Edited later");
      await markPurchaseCompleted(userId, docId);
      await updatePurchase(userId, docId, {
        title: "Edited later, renamed",
        currency: "EUR",
        purchasedAt: "2026-01-02",
      });
      assert.equal(await statusOf(docId), "completed");
      await updatePurchase(userId, docId, {
        title: "Edited later, renamed",
        currency: "EUR",
        purchasedAt: "2026-01-02",
        status: "preparing",
      });
      assert.equal(await statusOf(docId), "completed");
    });

    it("locks nothing: a copy identified into it still lands `to_sort`", async () => {
      const docId = await openingBalance("A piece left for later");
      await markPurchaseCompleted(userId, docId);
      const lotId = await createLot(userId, docId, null);
      const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
      const item = await prisma.item.findUniqueOrThrow({
        where: { id: copy.itemId },
        select: { deliveryState: true },
      });
      assert.equal(item.deliveryState, "to_sort");
      assert.equal(await statusOf(docId), "completed");
    });

    it("answers the Completed filter beside completed purchases, and never a delivery status", async () => {
      const inProgress = await openingBalance("Still being worked");
      const finished = await openingBalance("Finished");
      await markPurchaseCompleted(userId, finished);
      const purchase = await purchaseWithStatus("arrived");
      await markPurchaseCompleted(userId, purchase);

      const ids = async (filters: Parameters<typeof listPurchasesPaginated>[2]) =>
        (await listPurchasesPaginated(userId, collectionId, { ...filters, pageSize: 200 })).items.map(
          (p) => p.id
        );

      const completed = await ids({ status: "completed" });
      assert.ok(completed.includes(finished));
      assert.ok(completed.includes(purchase));
      assert.ok(!completed.includes(inProgress));

      const arrived = await ids({ status: "arrived" });
      assert.ok(!arrived.includes(inProgress));
      assert.ok(!arrived.includes(finished));

      const completedOpening = await ids({ type: "opening_balance", status: "completed" });
      assert.ok(completedOpening.includes(finished));
      assert.ok(!completedOpening.includes(purchase));
      assert.ok(!completedOpening.includes(inProgress));
    });
  });
});
