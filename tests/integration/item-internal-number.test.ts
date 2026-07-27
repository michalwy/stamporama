import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, deleteItem, listItemsPaginated } from "../../src/lib/items";
import { getCollectionItemNoPad, setCollectionItemNoPad } from "../../src/lib/collections";
import { DEFAULT_ITEM_NO_PAD } from "../../src/lib/item-number";

// Internal copy number (#268): a per-collection sequence assigned at creation. The guarantees that
// matter to a collector who has written the number on a physical piece — it starts at 1, never
// repeats, and is never reused after a deletion — are all database-level, so they are covered here
// rather than in the pure formatting unit tests.

const ts = Date.now();

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-itemno-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-itemno-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("internal copy number", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let stampId: string;
  let otherStampId: string;
  let conditionId: string;
  let otherConditionId: string;

  before(async () => {
    const user = await createTestUser(`${ts}`);
    userId = user.id;

    const collection = await prisma.collection.create({
      data: { slug: `col-itemno-a-${ts}`, name: "A", baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = collection.id;
    const other = await prisma.collection.create({
      data: { slug: `col-itemno-b-${ts}`, name: "B", baseCurrency: "EUR", ownerId: userId },
    });
    otherCollectionId = other.id;

    stampId = (await prisma.stamp.create({ data: { collectionId } })).id;
    otherStampId = (await prisma.stamp.create({ data: { collectionId: otherCollectionId } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
      })
    ).id;
    otherConditionId = (
      await prisma.stampCondition.create({
        data: { collectionId: otherCollectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId: { in: [collectionId, otherCollectionId] } } });
    await prisma.stampCondition.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.stamp.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("numbers a fresh collection from 1, in creation order", async () => {
    const first = await createItem(userId, collectionId, { stampId, conditionId });
    const second = await createItem(userId, collectionId, { stampId, conditionId });
    assert.equal(first.itemNo, 1);
    assert.equal(second.itemNo, 2);
  });

  it("never reuses the number of a deleted copy", async () => {
    const doomed = await createItem(userId, collectionId, { stampId, conditionId });
    await deleteItem(userId, doomed.id);
    const next = await createItem(userId, collectionId, { stampId, conditionId });
    assert.equal(next.itemNo, doomed.itemNo + 1);
  });

  it("keeps concurrent creates distinct", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, () => createItem(userId, collectionId, { stampId, conditionId }))
    );
    const numbers = created.map((i) => i.itemNo);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  it("numbers each collection independently", async () => {
    const inOther = await createItem(userId, otherCollectionId, {
      stampId: otherStampId,
      conditionId: otherConditionId,
    });
    assert.equal(inOther.itemNo, 1);
  });

  it("stores the display width per collection, rejecting an unusable one", async () => {
    assert.equal(await getCollectionItemNoPad(userId, collectionId), DEFAULT_ITEM_NO_PAD);
    await setCollectionItemNoPad(userId, collectionId, 3);
    assert.equal(await getCollectionItemNoPad(userId, collectionId), 3);
    // The other collection is untouched — the width is a per-collection display choice.
    assert.equal(await getCollectionItemNoPad(userId, otherCollectionId), DEFAULT_ITEM_NO_PAD);
    await assert.rejects(() => setCollectionItemNoPad(userId, collectionId, 0));
    await assert.rejects(() => setCollectionItemNoPad(userId, collectionId, 99));
    await setCollectionItemNoPad(userId, collectionId, DEFAULT_ITEM_NO_PAD);
  });

  it("finds a copy by its number, padded or not", async () => {
    const target = await createItem(userId, collectionId, { stampId, conditionId });
    for (const term of [`${target.itemNo}`, String(target.itemNo).padStart(5, "0"), `#${target.itemNo}`]) {
      const page = await listItemsPaginated(userId, collectionId, { search: term });
      assert.deepEqual(
        page.items.map((i) => i.id),
        [target.id],
        `search "${term}" should find exactly the copy`
      );
    }
  });
});
