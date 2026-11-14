import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated, listSelectableItemIds } from "../../src/lib/items";

// Select all on the Copies list (#2538): the bar's offer to extend a select-all to every copy
// matching the filters. Pinned here: the read answers through the list's own filters, keeps to the
// checkbox rule (a copy no longer held has no box), and under duplicate grouping leaves out the
// outliers a group's own box leaves out (#398) — and only those.

const ts = Date.now();
const DEFAULT_AXES = { condition: false, format: false, certificate: false };

describe("selectable copies matching the filters", () => {
  let userId: string;
  let collectionId: string;
  let mnhId: string;
  let usedId: string;
  const chopinMnh: string[] = [];
  let chopinUsed: string;
  let chopinWrittenOff: string;
  let curie: string;

  before(async () => {
    userId = `test-user-selectall-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User selectall-${ts}`,
        email: `test-selectall-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-selectall-${ts}`, name: "Sel", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    const chopin = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;
    const curieStamp = (await prisma.stamp.create({ data: { collectionId, name: "Curie" } })).id;

    // Chopin: three MNH and one used — with condition left at *any*, the used one is the outlier.
    for (let i = 0; i < 3; i++) {
      chopinMnh.push((await createItem(userId, collectionId, { stampId: chopin, conditionId: mnhId })).id);
    }
    chopinUsed = (await createItem(userId, collectionId, { stampId: chopin, conditionId: usedId })).id;
    // A Chopin MNH copy no longer held: shown only when asked for, and never given a box.
    chopinWrittenOff = (
      await createItem(userId, collectionId, { stampId: chopin, conditionId: mnhId })
    ).id;
    await prisma.item.update({
      where: { id: chopinWrittenOff },
      data: { disposedAt: new Date(), disposalReason: "lost" },
    });
    curie = (await createItem(userId, collectionId, { stampId: curieStamp, conditionId: mnhId })).id;
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("flat: every matching copy still held, the same set the list pages through", async () => {
    const ids = await listSelectableItemIds(userId, collectionId, {});
    assert.deepEqual(new Set(ids), new Set([...chopinMnh, chopinUsed, curie]));
    const listed = await listItemsPaginated(userId, collectionId, { pageSize: 50 });
    assert.deepEqual(new Set(ids), new Set(listed.items.map((i) => i.id)));
  });

  it("flat: a copy no longer held is shown when asked for, and still has no box to tick", async () => {
    const ids = await listSelectableItemIds(userId, collectionId, { includeDisposed: true });
    assert.ok(!ids.includes(chopinWrittenOff));
    assert.equal(ids.length, 5);
  });

  it("follows the filters", async () => {
    const ids = await listSelectableItemIds(userId, collectionId, { conditionIds: [usedId] });
    assert.deepEqual(ids, [chopinUsed]);
  });

  it("duplicates: the outlier a group's own box leaves out stays out", async () => {
    const ids = await listSelectableItemIds(userId, collectionId, {}, DEFAULT_AXES);
    assert.deepEqual(new Set(ids), new Set([...chopinMnh, curie]));
  });

  it("duplicates: split by condition, nothing is an outlier on condition", async () => {
    const ids = await listSelectableItemIds(userId, collectionId, {}, {
      ...DEFAULT_AXES,
      condition: true,
    });
    assert.deepEqual(new Set(ids), new Set([...chopinMnh, chopinUsed, curie]));
  });

  it("duplicates: the written-off copy shown still counts towards the majority, as on the row", async () => {
    // Shown, it is one of the group's members: four MNH against one used, so the used one is still
    // the outlier — and the written-off copy itself has no box.
    const ids = await listSelectableItemIds(userId, collectionId, { includeDisposed: true }, DEFAULT_AXES);
    assert.deepEqual(new Set(ids), new Set([...chopinMnh, curie]));
  });
});
