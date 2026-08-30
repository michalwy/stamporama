import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot, createLotWithStamps, intakeStamps } from "../../src/lib/lots";
import { createPurchase, setPurchaseStatus } from "../../src/lib/purchases";

// Where a copy created by intake lands on the delivery lifecycle (#121, #564). The order's own
// status is the assertion: a parcel already marked *Arrived* is on the desk, so a copy identified
// out of it is `to_sort` (in hand, not yet filed) rather than `ordered` (bought, still in the
// post). Both directions are pinned here because either one drifting is invisible until a
// collector has to advance a whole stockbook by hand.

describe("intake delivery state follows the order's status (#564)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let otherStampId: string;
  let checklistId: string;

  async function purchaseWithStatus(status: "preparing" | "in_transit" | "arrived") {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    if (status !== "preparing") await setPurchaseStatus(userId, purchase.id, status);
    const lotId = await createLot(userId, purchase.id, 10);
    return { purchaseId: purchase.id, lotId };
  }

  async function deliveryStateOf(itemId: string) {
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { deliveryState: true },
    });
    return item.deliveryState;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-intake-state-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User intake-state-${ts}`,
        email: `test-intake-state-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-intake-state-${ts}`,
        name: `Collection intake-state-${ts}`,
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
    const other = await prisma.stamp.create({ data: { collectionId, name: "Second stamp" } });
    otherStampId = other.id;

    const checklist = await prisma.checklist.create({
      data: {
        collectionId,
        name: "Test checklist",
        stamps: { create: [{ stampId }, { stampId: otherStampId }] },
      },
      select: { id: true },
    });
    checklistId = checklist.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a copy `ordered` while the order is still preparing", async () => {
    const { lotId } = await purchaseWithStatus("preparing");
    const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
    assert.equal(await deliveryStateOf(copy.itemId), "ordered");
  });

  it("creates a copy `ordered` while the order is in transit", async () => {
    const { lotId } = await purchaseWithStatus("in_transit");
    const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
    assert.equal(await deliveryStateOf(copy.itemId), "ordered");
  });

  it("creates a copy `to_sort` once the order has arrived", async () => {
    const { lotId } = await purchaseWithStatus("arrived");
    const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
    assert.equal(await deliveryStateOf(copy.itemId), "to_sort");
    // Landing in `to_sort` says "in hand, not filed" — it is not a shortcut into the collection.
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: copy.itemId },
      select: { inCollection: true },
    });
    assert.equal(item.inCollection, false);
  });

  it("applies to a whole-checklist intake, copy for copy", async () => {
    const { lotId } = await purchaseWithStatus("arrived");
    const copies = await intakeStamps(userId, { lotId }, { checklistId, conditionId });
    assert.equal(copies.length, 2);
    for (const copy of copies) {
      assert.equal(await deliveryStateOf(copy.itemId), "to_sort");
    }
  });

  it("applies to `add lot with stamps`, which creates the lot in the same step", async () => {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    await setPurchaseStatus(userId, purchase.id, "arrived");
    const { copies } = await createLotWithStamps(userId, purchase.id, {
      price: 10,
      stampId,
      conditionId,
    });
    assert.equal(copies.length, 1);
    assert.equal(await deliveryStateOf(copies[0].itemId), "to_sort");
  });

  it("reads the status at intake time, not at lot creation time", async () => {
    const { purchaseId, lotId } = await purchaseWithStatus("preparing");
    const [before] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
    await setPurchaseStatus(userId, purchaseId, "arrived");
    const [after] = await intakeStamps(userId, { lotId }, { stampId, conditionId });

    assert.equal(await deliveryStateOf(before.itemId), "ordered");
    assert.equal(await deliveryStateOf(after.itemId), "to_sort");
  });
});
