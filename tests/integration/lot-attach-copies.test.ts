import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { attachItemsToLot, listAttachableCopies } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";

// Attaching a copy that already exists to a lot (#388). The rules under test all follow from
// cost-basis being frozen at lot close (ADR-0009 §3): both ends must be open, a re-link off
// another open lot needs explicit consent, and nothing but `lotId` may change.

describe("attachItemsToLot (#388)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let targetLotId: string;
  let otherOpenLotId: string;
  let closedLotId: string;
  let nextItemNo = 1;

  async function addCopy(
    lotId: string | null,
    overrides: { deliveryState?: string; inCollection?: boolean } = {}
  ) {
    const item = await prisma.item.create({
      data: {
        collectionId,
        itemNo: nextItemNo++,
        stampId,
        conditionId,
        lotId,
        deliveryState: overrides.deliveryState ?? "delivered",
        inCollection: overrides.inCollection ?? true,
      },
      select: { id: true },
    });
    return item.id;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-attach-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User attach-${ts}`,
        email: `test-attach-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-attach-${ts}`,
        name: `Collection attach-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany" },
    });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test stamp" } });
    stampId = stamp.id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });

    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const target = await prisma.purchaseLot.create({
      data: { purchaseId: purchase.id, title: "Target", price: "10.00", status: "open" },
      select: { id: true },
    });
    targetLotId = target.id;

    const other = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    const openLot = await prisma.purchaseLot.create({
      data: { purchaseId: other.id, title: "Other open", price: "5.00", status: "open" },
      select: { id: true },
    });
    otherOpenLotId = openLot.id;
    const shut = await prisma.purchaseLot.create({
      data: { purchaseId: other.id, title: "Other closed", price: "5.00", status: "closed" },
      select: { id: true },
    });
    closedLotId = shut.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("attaches an unlinked copy and changes nothing else about it", async () => {
    const itemId = await addCopy(null, { deliveryState: "delivered", inCollection: true });
    const before = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });

    const result = await attachItemsToLot(userId, targetLotId, [itemId]);
    assert.deepEqual(result, { attached: 1, refused: [] });

    const after = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(after.lotId, targetLotId);
    // A copy already in hand does not go back to `ordered`, and its internal number is
    // written on the physical piece — neither may move.
    assert.equal(after.deliveryState, before.deliveryState);
    assert.equal(after.inCollection, before.inCollection);
    assert.equal(after.itemNo, before.itemNo);
    assert.equal(after.costBasis, null);
  });

  it("is a no-op for a copy already on the lot", async () => {
    const itemId = await addCopy(targetLotId);
    const result = await attachItemsToLot(userId, targetLotId, [itemId]);
    assert.deepEqual(result, { attached: 0, refused: [] });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(after.lotId, targetLotId);
  });

  it("refuses a copy on another open lot until the move is confirmed", async () => {
    const itemId = await addCopy(otherOpenLotId);

    const refusedRun = await attachItemsToLot(userId, targetLotId, [itemId]);
    assert.equal(refusedRun.attached, 0);
    assert.equal(refusedRun.refused.length, 1);
    assert.equal(refusedRun.refused[0].itemId, itemId);
    assert.match(refusedRun.refused[0].reason, /another purchase/);
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).lotId,
      otherOpenLotId
    );

    const allowed = await attachItemsToLot(userId, targetLotId, [itemId], { allowRelink: true });
    assert.deepEqual(allowed, { attached: 1, refused: [] });
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).lotId,
      targetLotId
    );
  });

  it("refuses a copy frozen into a closed lot, even with the move confirmed", async () => {
    const itemId = await addCopy(closedLotId);
    const result = await attachItemsToLot(userId, targetLotId, [itemId], { allowRelink: true });
    assert.equal(result.attached, 0);
    assert.match(result.refused[0].reason, /closed lot/);
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).lotId,
      closedLotId
    );
  });

  it("collects refusals rather than abandoning the copies that can go on", async () => {
    const good = await addCopy(null);
    const stuck = await addCopy(closedLotId);
    const result = await attachItemsToLot(userId, targetLotId, [good, stuck]);
    assert.equal(result.attached, 1);
    assert.equal(result.refused.length, 1);
    assert.equal(result.refused[0].itemId, stuck);
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: good } })).lotId,
      targetLotId
    );
  });

  it("refuses to attach anything to a closed lot at all", async () => {
    const itemId = await addCopy(null);
    await assert.rejects(
      () => attachItemsToLot(userId, closedLotId, [itemId]),
      /This lot is closed\. Reopen it/
    );
  });

  it("offers the unlinked and open-lot copies, and never the closed-lot or already-on ones", async () => {
    const unlinked = await addCopy(null);
    const onOpenLot = await addCopy(otherOpenLotId);
    const onClosedLot = await addCopy(closedLotId);
    const alreadyHere = await addCopy(targetLotId);

    const offered = new Set(
      (await listAttachableCopies(userId, targetLotId)).map((i) => i.id)
    );
    assert.ok(offered.has(unlinked), "an unlinked copy is attachable");
    assert.ok(offered.has(onOpenLot), "a copy on another open lot is attachable (with consent)");
    assert.ok(!offered.has(onClosedLot), "a copy frozen into a closed lot is not offered");
    assert.ok(!offered.has(alreadyHere), "a copy already on this lot is not offered");
  });

  it("reports the owning purchase on an offered copy, so the dialog can name what it leaves", async () => {
    const onOpenLot = await addCopy(otherOpenLotId);
    const rows = await listAttachableCopies(userId, targetLotId);
    const row = rows.find((r) => r.id === onOpenLot);
    assert.ok(row, "the copy is offered");
    assert.ok(row.purchase, "it carries its purchase (#387)");
    assert.match(row.purchase.label, /2026-02-01/);
  });
});
