import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { moveItemsToLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";

// Moving copies between lots of one purchase from the copies themselves (#1918). It is #388's
// attach narrowed to one order, so the same rules hold: only `lotId` changes, both ends must be
// open (ADR-0009 §3), and a copy the rules refuse is named while the rest move.

describe("moveItemsToLot (#1918)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let purchaseId: string;
  let lotA: string;
  let lotB: string;
  let closedLot: string;
  let otherPurchaseLot: string;
  let locationId: string;
  let nextItemNo = 1;

  async function addCopy(lotId: string | null) {
    const item = await prisma.item.create({
      data: {
        collectionId,
        itemNo: nextItemNo++,
        stampId,
        conditionId,
        lotId,
        locationId,
        deliveryState: "to_sort",
        inCollection: false,
        forSale: true,
      },
      select: { id: true, itemNo: true },
    });
    return item;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-move-lot-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User move-lot-${ts}`,
        email: `test-move-lot-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-move-lot-${ts}`,
        name: `Collection move-lot-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Chopin 1949" } });
    stampId = stamp.id;
    const location = await prisma.location.create({ data: { collectionId, name: "Box 1" } });
    locationId = location.id;

    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    purchaseId = purchase.id;
    const mk = async (pid: string, title: string, status: string) =>
      (
        await prisma.purchaseLot.create({
          data: { purchaseId: pid, title, price: "10.00", status },
          select: { id: true },
        })
      ).id;
    lotA = await mk(purchaseId, "Lot A", "open");
    lotB = await mk(purchaseId, "Lot B", "open");
    closedLot = await mk(purchaseId, "Shut", "closed");

    const other = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    otherPurchaseLot = await mk(other.id, "Elsewhere", "open");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("moves a copy to another lot of the purchase and changes nothing else about it", async () => {
    const { id } = await addCopy(lotA);
    const before = await prisma.item.findUniqueOrThrow({ where: { id } });

    const result = await moveItemsToLot(userId, lotB, { itemIds: [id] });
    assert.equal(result.moved, 1);
    assert.deepEqual(result.refused, []);
    assert.deepEqual(new Set(result.lotIds), new Set([lotA, lotB]));

    const after = await prisma.item.findUniqueOrThrow({ where: { id } });
    assert.equal(after.lotId, lotB);
    assert.equal(after.deliveryState, before.deliveryState);
    assert.equal(after.inCollection, before.inCollection);
    assert.equal(after.forSale, before.forSale);
    assert.equal(after.locationId, before.locationId);
    assert.equal(after.conditionId, before.conditionId);
    assert.equal(after.itemNo, before.itemNo);
    assert.equal(after.costBasis, null);
  });

  it("names a copy on a closed lot and moves the rest", async () => {
    const good = await addCopy(lotA);
    const stuck = await addCopy(closedLot);

    const result = await moveItemsToLot(userId, lotB, { itemIds: [good.id, stuck.id] });
    assert.equal(result.moved, 1);
    assert.equal(result.refused.length, 1);
    assert.equal(result.refused[0].itemId, stuck.id);
    assert.match(result.refused[0].copy, /^Chopin 1949 \(#0*\d+\)$/);
    assert.ok(result.refused[0].copy.endsWith(`${stuck.itemNo})`));
    assert.match(result.refused[0].reason, /Shut.*closed.*Reopen/);

    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: good.id } })).lotId, lotB);
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: stuck.id } })).lotId,
      closedLot
    );
  });

  it("never pulls in a copy from another purchase or from no lot", async () => {
    const foreign = await addCopy(otherPurchaseLot);
    const loose = await addCopy(null);

    const result = await moveItemsToLot(userId, lotB, { itemIds: [foreign.id, loose.id] });
    assert.equal(result.moved, 0);
    assert.deepEqual(result.lotIds, []);
    assert.equal(result.refused.length, 2);
    for (const r of result.refused) assert.match(r.reason, /Attach existing copies/);
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: foreign.id } })).lotId,
      otherPurchaseLot
    );
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: loose.id } })).lotId, null);
  });

  it("is a no-op for a copy already on the target", async () => {
    const { id } = await addCopy(lotB);
    const result = await moveItemsToLot(userId, lotB, { itemIds: [id] });
    assert.deepEqual(result, { moved: 0, refused: [], lotIds: [] });
  });

  it("refuses a closed target outright", async () => {
    const { id } = await addCopy(lotA);
    await assert.rejects(
      () => moveItemsToLot(userId, closedLot, { itemIds: [id] }),
      /This lot is closed\. Reopen it/
    );
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id } })).lotId, lotA);
  });

  it("moves a selection-bar scope, bounded to the target's purchase", async () => {
    // A fresh source lot, so the whole-lot container holds exactly these copies.
    const source = (
      await prisma.purchaseLot.create({
        data: { purchaseId, title: "Source", price: "1.00", status: "open" },
        select: { id: true },
      })
    ).id;
    const a = await addCopy(source);
    const b = await addCopy(source);
    const foreign = await addCopy(otherPurchaseLot);

    const result = await moveItemsToLot(userId, lotB, {
      scope: {
        purchaseId,
        onlyOpenLots: true,
        selectors: [{ lotId: source }],
        // Named by the client, but on another purchase: the scope cannot reach it.
        itemIds: [foreign.id],
      },
    });
    assert.equal(result.moved, 2);
    assert.deepEqual(result.refused, []);
    for (const id of [a.id, b.id]) {
      assert.equal((await prisma.item.findUniqueOrThrow({ where: { id } })).lotId, lotB);
    }
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: foreign.id } })).lotId,
      otherPurchaseLot
    );
  });

  it("refuses another owner's lot", async () => {
    const { id } = await addCopy(lotA);
    await assert.rejects(
      () => moveItemsToLot("someone-else", lotB, { itemIds: [id] }),
      /Lot not found or access denied/
    );
  });
});
