import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot, intakeStamps, updateLotCopy } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { copyRowPatch } from "../../src/app/c/[collectionSlug]/purchases/[purchaseId]/lot-copies-keys";

// One copy's edit from its own row on a purchase (#2262). The screen sets the row from the write's
// answer instead of reading the lot again, so what is pinned: the answer is the copy as it now
// stands, it names the copy's lot, it agrees with what the row drew before the save, and it
// reaches no other copy.

const TS = Date.now();

describe("one copy's row edit on a purchase (#2262)", () => {
  let userId: string;
  let collectionId: string;
  let lotId: string;
  let copyId: string;
  let otherCopyId: string;
  let locationId: string;

  before(async () => {
    userId = `test-user-row-edit-${TS}`;
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
        data: { slug: `col-row-edit-${TS}`, name: "Row edit", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp" } })).id;
    locationId = (
      await prisma.location.create({ data: { collectionId, name: "Box", code: "B" } })
    ).id;
    const purchaseId = (
      await createPurchase(userId, collectionId, {
        purchasedAt: "2026-10-01",
        currency: "EUR",
        status: "arrived",
      })
    ).id;
    lotId = await createLot(userId, purchaseId, 10, null);
    [copyId, otherCopyId] = (
      await intakeStamps(userId, { lotId }, { stampId, conditionId, copies: 2 })
    ).map((c) => c.itemId);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers with the copy as it now stands and the lot it sits in", async () => {
    const r = await updateLotCopy(userId, copyId, { forSale: true });
    assert.equal(r.copy.forSale, true);
    assert.deepEqual(r.lotIds, [lotId]);
    const other = await prisma.item.findUniqueOrThrow({ where: { id: otherCopyId } });
    assert.equal(other.forSale, false);
  });

  it("agrees with what the row drew before the save", async () => {
    for (const changes of [
      { deliveryState: "delivered" },
      { inCollection: true },
      { deliveryState: "to_sort" },
      { locationId },
      { locationId: null },
    ]) {
      const r = await updateLotCopy(userId, copyId, changes);
      for (const [field, value] of Object.entries(copyRowPatch(changes))) {
        assert.equal(r.copy[field as keyof typeof r.copy], value, `${JSON.stringify(changes)} ${field}`);
      }
    }
  });

  it("names the copy it moved into the collector's hands", async () => {
    await updateLotCopy(userId, copyId, { deliveryState: "to_sort" });
    const r = await updateLotCopy(userId, copyId, { deliveryState: "delivered" });
    assert.deepEqual(
      r.delivered.map((c) => c.itemId),
      [copyId]
    );
  });
});
