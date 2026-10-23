import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot, intakeStamps } from "../../src/lib/lots";
import { createPurchase, listPurchasesPaginated } from "../../src/lib/purchases";

// The Intake documents list's *N copies* (#2125): every copy filed on the document's lots, whatever
// has happened to it since. What needs a database is that the count runs across lots, that a copy
// gone from the collection still counts, that a cover of several stamps is one copy, and that a scan
// tile not yet identified is none.

describe("Intake documents list — how many copies a document holds (#2125)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampA: string;
  let stampB: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-intake-copies-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User intake-copies-${ts}`,
        email: `test-intake-copies-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-intake-copies-${ts}`, name: "Intake copies", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampA = (await prisma.stamp.create({ data: { collectionId, name: "Stamp A" } })).id;
    stampB = (await prisma.stamp.create({ data: { collectionId, name: "Stamp B" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function copyCountOf(purchaseId: string) {
    const { items } = await listPurchasesPaginated(userId, collectionId, { pageSize: 200 });
    return items.find((p) => p.id === purchaseId)?.copyCount;
  }

  it("counts every copy across the lots, a sold one and a cover of two stamps included, and no tile", async () => {
    const purchase = await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-10-01" });
    const first = await createLot(userId, purchase.id, 10);
    const second = await createLot(userId, purchase.id, 5);
    const [sold] = await intakeStamps(userId, { lotId: first }, { stampId: stampA, conditionId, copies: 2 });
    await intakeStamps(
      userId,
      { lotId: second },
      { stampId: stampA, conditionId, stamps: [{ stampId: stampA }, { stampId: stampB }] }
    );
    await prisma.item.update({ where: { id: sold.itemId }, data: { disposedAt: new Date() } });
    const sheet = await prisma.scanSheet.create({
      data: {
        collectionId,
        purchaseId: purchase.id,
        batchNo: 1,
        side: "front",
        storageKey: `test/${purchase.id}/1-front`,
        mime: "image/png",
        width: 100,
        height: 100,
        viewWidth: 100,
        viewHeight: 100,
        sizeBytes: 1,
      },
    });
    await prisma.scanTile.create({
      data: { collectionId, purchaseId: purchase.id, batchNo: 1, position: 1, frontSheetId: sheet.id },
    });

    assert.equal(await copyCountOf(purchase.id), 3);
  });

  it("says 0 on a document with no copies yet, an opening balance as a purchase", async () => {
    const purchase = await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-10-02" });
    await createLot(userId, purchase.id, 10);
    const opening = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "Stockbook",
      currency: "EUR",
      purchasedAt: "2026-10-02",
    });
    assert.equal(await copyCountOf(purchase.id), 0);
    assert.equal(await copyCountOf(opening.id), 0);
  });

  it("counts an opening balance's copies the same way", async () => {
    const opening = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "Klaser",
      currency: "EUR",
      purchasedAt: "2026-10-03",
    });
    const lotId = await createLot(userId, opening.id, null);
    await intakeStamps(userId, { lotId }, { stampId: stampB, conditionId, copies: 4 });
    assert.equal(await copyCountOf(opening.id), 4);
  });
});
