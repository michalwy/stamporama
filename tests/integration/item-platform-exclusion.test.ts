import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  listItemsPaginated,
  setItemPlatformExclusion,
  updateItem,
} from "../../src/lib/items";

// #506 — a copy the collector has decided never to list on one platform.
//
// The *not offered on X* worklist (#259) is the reason the flag exists: a copy deliberately kept
// off a marketplace answers that question truthfully for ever, and a backlog of them buries the
// copy that arrived yesterday. So the two behaviours worth pinning down are that an exclusion
// **removes** a copy from that worklist, and that it stays reachable through the review read that
// undoes it — per platform, and without touching anything else about the copy.

describe("per-platform copy exclusions", () => {
  let userId: string;
  let collectionId: string;
  let colnectId: string;
  let delcampeId: string;
  let kept: string, setAside: string, other: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-excl-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User excl-${ts}`,
        email: `test-excl-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-excl-${ts}`,
        name: `Collection excl-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Mercury" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    colnectId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
    delcampeId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;

    const forSale = { stampId: stamp.id, conditionId: condition.id, forSale: true };
    kept = (await createItem(userId, collectionId, forSale)).id;
    setAside = (await createItem(userId, collectionId, forSale)).id;
    other = (await createItem(userId, collectionId, forSale)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("drops an excluded copy from 'not offered on X' and finds it under the review read", async () => {
    await setItemPlatformExclusion(userId, collectionId, [setAside], colnectId, true);

    const worklist = await listItemsPaginated(userId, collectionId, {
      notOfferedPlatformId: colnectId,
    });
    const worklistIds = worklist.items.map((i) => i.id);
    assert.ok(!worklistIds.includes(setAside), "the copy set aside is off the worklist");
    assert.ok(worklistIds.includes(kept), "every other for-sale copy is still on it");

    const review = await listItemsPaginated(userId, collectionId, {
      excludedPlatformId: colnectId,
    });
    assert.deepEqual(
      review.items.map((i) => i.id),
      [setAside],
      "the review read is exactly what was set aside"
    );
    assert.deepEqual(
      review.items[0].excludedPlatformIds,
      [colnectId],
      "the row carries the platform it is kept off, for its chip"
    );
  });

  it("is scoped to one platform — the copy still needs listing everywhere else", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {
      notOfferedPlatformId: delcampeId,
    });
    assert.ok(
      items.map((i) => i.id).includes(setAside),
      "excluding from Colnect says nothing about Delcampe"
    );
  });

  it("is idempotent in both directions, and reversible", async () => {
    // Setting it twice over a mixed selection is the normal case when working through a worklist.
    await setItemPlatformExclusion(userId, collectionId, [setAside, other], colnectId, true);
    await setItemPlatformExclusion(userId, collectionId, [setAside, other], colnectId, true);
    assert.equal(
      await prisma.itemPlatformExclusion.count({
        where: { platformId: colnectId, itemId: { in: [setAside, other] } },
      }),
      2,
      "one row per copy, however often the write runs"
    );

    await setItemPlatformExclusion(userId, collectionId, [other], colnectId, false);
    await setItemPlatformExclusion(userId, collectionId, [other], colnectId, false);
    const { items } = await listItemsPaginated(userId, collectionId, {
      notOfferedPlatformId: colnectId,
    });
    assert.ok(
      items.map((i) => i.id).includes(other),
      "allowed again, the copy is back on the worklist"
    );
  });

  it("refuses a platform that is not one of this collection's", async () => {
    await assert.rejects(
      () => setItemPlatformExclusion(userId, collectionId, [kept], "no-such-platform", true),
      /Platform not found/
    );
  });

  it("replaces the whole set from the copy form, and leaves it alone when unasked", async () => {
    await updateItem(userId, kept, { excludedPlatformIds: [colnectId, delcampeId] });
    let row = await listItemsPaginated(userId, collectionId, { excludedPlatformId: delcampeId });
    assert.deepEqual(row.items.map((i) => i.id), [kept]);

    // An edit that says nothing about platforms must not clear them — most callers never ask.
    await updateItem(userId, kept, { notes: "unrelated" });
    row = await listItemsPaginated(userId, collectionId, { excludedPlatformId: delcampeId });
    assert.deepEqual(row.items.map((i) => i.id), [kept], "untouched by an unrelated edit");

    // An explicit list, including a shorter one, is the whole answer.
    await updateItem(userId, kept, { excludedPlatformIds: [colnectId] });
    row = await listItemsPaginated(userId, collectionId, { excludedPlatformId: delcampeId });
    assert.deepEqual(row.items.map((i) => i.id), [], "unticked platforms are dropped");
  });

  it("forgets the exclusions of a deleted platform rather than blocking the delete", async () => {
    const gone = await prisma.contact.create({
      data: { collectionId, name: "Ephemera", platform: true },
    });
    await setItemPlatformExclusion(userId, collectionId, [kept], gone.id, true);
    await prisma.contact.delete({ where: { id: gone.id } });
    assert.equal(
      await prisma.itemPlatformExclusion.count({ where: { platformId: gone.id } }),
      0,
      "a preference about a platform that no longer exists goes with it"
    );
  });
});
