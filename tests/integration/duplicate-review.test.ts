import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, disposeItem } from "../../src/lib/items";
import {
  keepAllDuplicates,
  keepDuplicate,
  listDuplicateReview,
  listReplacements,
  unkeepAllDuplicates,
} from "../../src/lib/replacements";

// The Replacements screen's duplicate review (#1938): the stamps held in the collection more than
// once, picking the keeper records the rest as pairs replaced by it, and *Keep all* takes a stamp
// out until another copy joins.

async function seedFixtures(suffix: string) {
  const user = await prisma.user.create({
    data: {
      id: `test-user-dupreview-${suffix}`,
      name: "Duplicate review",
      email: `test-dupreview-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-dupreview-${suffix}`, name: "Review", baseCurrency: "EUR", ownerId: user.id },
  });
  const [mnh, used] = await Promise.all([
    prisma.stampCondition.create({
      data: { collectionId: collection.id, name: "MNH", abbreviation: "**", sortOrder: 0 },
    }),
    prisma.stampCondition.create({
      data: { collectionId: collection.id, name: "Used", abbreviation: "U", sortOrder: 1 },
    }),
  ]);
  const area = await prisma.collectionArea.create({
    data: { collectionId: collection.id, name: "Poland" },
  });
  const otherArea = await prisma.collectionArea.create({
    data: { collectionId: collection.id, name: "Germany" },
  });
  const album = await prisma.location.create({
    data: { collectionId: collection.id, code: "L1", name: "Album", assignable: true },
  });
  return {
    userId: user.id,
    collectionId: collection.id,
    mnhId: mnh.id,
    usedId: used.id,
    areaId: area.id,
    otherAreaId: otherArea.id,
    albumId: album.id,
  };
}

describe("duplicate review (#1938)", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;

  before(async () => {
    f = await seedFixtures(`${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
    await prisma.user.delete({ where: { id: f.userId } });
  });

  async function addStamp(name: string, areaId = f.areaId) {
    const stamp = await prisma.stamp.create({ data: { collectionId: f.collectionId, name } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
    });
    return stamp;
  }

  async function addCopy(
    stampId: string,
    opts: { conditionId?: string; inCollection?: boolean } = {}
  ) {
    return createItem(f.userId, f.collectionId, {
      stampId,
      conditionId: opts.conditionId ?? f.mnhId,
      inCollection: opts.inCollection ?? true,
      forSale: !(opts.inCollection ?? true),
      locationId: f.albumId,
      locationRef: "P1",
    });
  }

  async function reviewedNames(filters: Parameters<typeof listDuplicateReview>[2] = {}) {
    const page = await listDuplicateReview(f.userId, f.collectionId, filters);
    return page.stacks.map((s) => s.stampLabel);
  }

  it("lists the stamps held in the collection more than once, with their copies", async () => {
    const twice = await addStamp("Twice");
    const once = await addStamp("Once");
    const forSale = await addStamp("For sale");
    const a = await addCopy(twice.id);
    const b = await addCopy(twice.id);
    await addCopy(once.id);
    await addCopy(forSale.id);
    await addCopy(forSale.id, { inCollection: false });

    const page = await listDuplicateReview(f.userId, f.collectionId, {});
    const stack = page.stacks.find((s) => s.stampLabel === "Twice");
    assert.ok(stack);
    assert.deepEqual(stack.copies.map((c) => c.id).sort(), [a.id, b.id].sort());
    assert.equal(stack.copies[0].locationPath, "Album");
    assert.ok(!(await reviewedNames()).includes("Once"));
    assert.ok(!(await reviewedNames()).includes("For sale"));

    // A copy disposed of is no longer held, so the stamp is held once.
    await disposeItem(f.userId, b.id, { reason: "lost", note: null });
    assert.ok(!(await reviewedNames()).includes("Twice"));
  });

  it("counts the same stamp as duplicate grouping does, Split by condition included", async () => {
    const stamp = await addStamp("Mint and used");
    await addCopy(stamp.id, { conditionId: f.mnhId });
    await addCopy(stamp.id, { conditionId: f.usedId });
    assert.ok((await reviewedNames()).includes("Mint and used"));
    const split = await reviewedNames({
      axes: { condition: true, format: false, certificate: false },
    });
    assert.ok(!split.includes("Mint and used"));
    // The condition filter narrows the copies the stacks are counted over.
    assert.ok(!(await reviewedNames({ conditionIds: [f.mnhId] })).includes("Mint and used"));
  });

  it("narrows by area", async () => {
    const stamp = await addStamp("Elsewhere", f.otherAreaId);
    await addCopy(stamp.id);
    await addCopy(stamp.id);
    assert.ok((await reviewedNames({ areaIds: [f.otherAreaId] })).includes("Elsewhere"));
    assert.ok(!(await reviewedNames({ areaIds: [f.areaId] })).includes("Elsewhere"));
  });

  it("Keep this records every other copy as a pair replaced by the keeper, moving nothing", async () => {
    const stamp = await addStamp("Three");
    const a = await addCopy(stamp.id);
    const b = await addCopy(stamp.id);
    const c = await addCopy(stamp.id);
    const { recorded } = await keepDuplicate(f.userId, f.collectionId, {
      keeperId: b.id,
      otherIds: [a.id, c.id],
    });
    assert.equal(recorded, 2);

    const { open } = await listReplacements(f.userId, f.collectionId);
    const pairs = open.filter((p) => p.newCopy?.id === b.id);
    assert.deepEqual(pairs.map((p) => p.oldCopy?.id).sort(), [a.id, c.id].sort());
    const old = await prisma.item.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(old.inCollection, true);
    assert.equal(old.locationRef, "P1");

    // Settled as far as the review goes: the duplicates are already in open pairs.
    assert.ok(!(await reviewedNames()).includes("Three"));

    // A fourth copy brings the stamp back, the pair-bound copies shown with their pair.
    const d = await addCopy(stamp.id);
    const page = await listDuplicateReview(f.userId, f.collectionId, {});
    const stack = page.stacks.find((s) => s.stampLabel === "Three");
    assert.ok(stack);
    assert.equal(stack.copies.length, 4);
    assert.equal(stack.copies.find((x) => x.id === a.id)?.replacedByItemNo, b.itemNo);
    assert.deepEqual(
      stack.copies.find((x) => x.id === b.id)?.replacesItemNos,
      [a.itemNo, c.itemNo].sort((x, y) => x - y)
    );

    // A copy already being replaced is not offered twice — neither as a keeper nor as another's.
    await assert.rejects(
      () => keepDuplicate(f.userId, f.collectionId, { keeperId: a.id, otherIds: [d.id] }),
      /already being replaced/
    );
    await assert.rejects(
      () => keepDuplicate(f.userId, f.collectionId, { keeperId: d.id, otherIds: [b.id, a.id] }),
      /already being replaced/
    );
    // Nothing was written by the refused call.
    const after = await listReplacements(f.userId, f.collectionId);
    assert.equal(after.open.filter((p) => p.newCopy?.id === d.id).length, 0);
  });

  it("Keep all takes a stamp out until another copy joins, and undo brings it back", async () => {
    const stamp = await addStamp("Keep both");
    const a = await addCopy(stamp.id);
    const b = await addCopy(stamp.id);
    const { marked } = await keepAllDuplicates(f.userId, f.collectionId, [a.id, b.id]);
    assert.deepEqual(marked.sort(), [a.id, b.id].sort());
    assert.ok(!(await reviewedNames()).includes("Keep both"));

    await unkeepAllDuplicates(f.userId, f.collectionId, marked);
    assert.ok((await reviewedNames()).includes("Keep both"));

    await keepAllDuplicates(f.userId, f.collectionId, [a.id, b.id]);
    await addCopy(stamp.id);
    const page = await listDuplicateReview(f.userId, f.collectionId, {});
    assert.equal(page.stacks.find((s) => s.stampLabel === "Keep both")?.copies.length, 3);

    // A second Keep all marks only the newcomer — what an undo would take back.
    const third = page.stacks.find((s) => s.stampLabel === "Keep both")!.copies.map((c) => c.id);
    const again = await keepAllDuplicates(f.userId, f.collectionId, third);
    assert.equal(again.marked.length, 1);
  });

  it("refuses another collection's owner", async () => {
    await assert.rejects(
      () => listDuplicateReview("someone-else", f.collectionId, {}),
      /access denied/
    );
  });
});
