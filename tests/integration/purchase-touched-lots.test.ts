import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  bulkUpdateLotItems,
  bulkUpdateLotItemsScoped,
  createLot,
  intakeStamps,
  resolveTouchedLots,
} from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";

// Which lots of an order a write on its screen touched (#1409) — what the screen re-reads after it,
// in place of every lot. What is pinned: a written lot or copy touches its own lot and no other,
// however many lots the order has; a written stamp reaches the lots holding a copy of it, of a stamp
// above it (an unknown-variant copy is valued from its variants) or below it (the intake step prices
// those), and not the lots holding an unrelated stamp; nothing outside the order is answered; and the
// bulk writes report the lots their copies sit in, read before the write so a scope ticked under
// *to sort* still names the lot it has just sorted.

const TS = Date.now();
const LOTS = 30;

describe("the lots a write on the order screen touched (#1409)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let purchaseId: string;
  let umbrellaId: string;
  let variantId: string;
  let subVariantId: string;
  let unrelatedId: string;
  /** Lot i holds one copy of `unrelated`; three of them also hold the variant family. */
  const lotIds: string[] = [];
  const firstCopyOfLot: string[] = [];
  let umbrellaLot: string;
  let variantLot: string;
  let subVariantLot: string;
  let foreignLot: string;
  let foreignCopy: string;

  before(async () => {
    userId = `test-user-touched-${TS}`;
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
        data: { slug: `col-touched-${TS}`, name: "Touched", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const stamp = async (name: string, parentId: string | null = null) =>
      (await prisma.stamp.create({ data: { collectionId, name, parentId } })).id;
    umbrellaId = await stamp("Umbrella");
    variantId = await stamp("Variant", umbrellaId);
    subVariantId = await stamp("Sub-variant", variantId);
    unrelatedId = await stamp("Unrelated");

    purchaseId = (
      await createPurchase(userId, collectionId, {
        purchasedAt: "2026-09-01",
        currency: "EUR",
        status: "arrived",
      })
    ).id;
    for (let i = 0; i < LOTS; i++) {
      const lotId = await createLot(userId, purchaseId, 10, null);
      const [copy] = await intakeStamps(userId, { lotId }, { stampId: unrelatedId, conditionId });
      lotIds.push(lotId);
      firstCopyOfLot.push(copy.itemId);
    }
    umbrellaLot = lotIds[3];
    variantLot = lotIds[11];
    subVariantLot = lotIds[20];
    await intakeStamps(userId, { lotId: umbrellaLot }, { stampId: umbrellaId, conditionId });
    await intakeStamps(userId, { lotId: variantLot }, { stampId: variantId, conditionId });
    await intakeStamps(userId, { lotId: subVariantLot }, { stampId: subVariantId, conditionId });

    // Another order of the same collection, holding the same stamps: never an answer.
    const otherPurchase = (
      await createPurchase(userId, collectionId, {
        purchasedAt: "2026-09-02",
        currency: "EUR",
        status: "arrived",
      })
    ).id;
    foreignLot = await createLot(userId, otherPurchase, 10, null);
    foreignCopy = (
      await intakeStamps(userId, { lotId: foreignLot }, { stampId: variantId, conditionId })
    )[0].itemId;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const sorted = (ids: string[]) => [...ids].sort();

  it("answers a written lot with that lot alone, whatever the order holds", async () => {
    assert.deepEqual(await resolveTouchedLots(userId, purchaseId, { lotIds: [lotIds[7]] }), [
      lotIds[7],
    ]);
  });

  it("answers a written copy with its own lot alone", async () => {
    assert.deepEqual(
      await resolveTouchedLots(userId, purchaseId, { itemIds: [firstCopyOfLot[17]] }),
      [lotIds[17]]
    );
  });

  it("answers a stamp with the lots holding it, a stamp above it or one below it", async () => {
    // A price on the variant revalues the umbrella's unknown-variant copies, and the intake step
    // prices the sub-variant beneath it.
    assert.deepEqual(
      sorted(await resolveTouchedLots(userId, purchaseId, { stampIds: [variantId] })),
      sorted([umbrellaLot, variantLot, subVariantLot])
    );
    // From the bottom of the tree, every generation above it.
    assert.deepEqual(
      sorted(await resolveTouchedLots(userId, purchaseId, { stampIds: [subVariantId] })),
      sorted([umbrellaLot, variantLot, subVariantLot])
    );
  });

  it("does not answer lots holding only an unrelated stamp", async () => {
    const touched = await resolveTouchedLots(userId, purchaseId, { stampIds: [umbrellaId] });
    assert.equal(touched.length, 3);
    assert.ok(!touched.includes(lotIds[0]));
  });

  it("answers nothing outside the order", async () => {
    assert.deepEqual(
      await resolveTouchedLots(userId, purchaseId, {
        lotIds: [foreignLot],
        itemIds: [foreignCopy],
      }),
      []
    );
  });

  it("refuses an order that is not the caller's", async () => {
    await assert.rejects(() =>
      resolveTouchedLots("someone-else", purchaseId, { lotIds: [lotIds[0]] })
    );
  });

  it("reports the lots a bulk change reached", async () => {
    const result = await bulkUpdateLotItems(userId, [firstCopyOfLot[4], firstCopyOfLot[9]], {
      locationId: null,
    });
    assert.deepEqual(sorted(result.lotIds), sorted([lotIds[4], lotIds[9]]));
  });

  it("names the lot a scope ticked under *to sort* has just sorted", async () => {
    await prisma.item.updateMany({
      where: { id: firstCopyOfLot[5] },
      data: { deliveryState: "to_sort" },
    });
    const result = await bulkUpdateLotItemsScoped(
      userId,
      collectionId,
      { purchaseId, selectors: [{ lotId: lotIds[5], filter: "to-sort" }] },
      { markSorted: true }
    );
    assert.equal(result.count, 1);
    assert.deepEqual(result.lotIds, [lotIds[5]]);
  });
});
