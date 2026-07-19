import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getStampSubtypes,
  createStampSubtype,
  updateStampSubtype,
  setSubtypeActsAsVariant,
  setDefaultSubtype,
  deleteStampSubtype,
  reorderStampSubtypes,
  seedDefaultSubtypes,
  DEFAULT_STAMP_SUBTYPES,
  SubtypeInUseError,
  SubtypeIsDefaultError,
} from "../../src/lib/subtypes";
import { createCollection } from "../../src/lib/collections";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-sub-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-sub-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/** Raw collection with no seeded subtypes (bypasses createCollection). */
async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-sub-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("createStampSubtype", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cs-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cs-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("appends subtypes with increasing sortOrder and never as default", async () => {
    await createStampSubtype(userId, collectionId, { name: "Colour variety", actsAsVariant: true });
    await createStampSubtype(userId, collectionId, { name: "Error", actsAsVariant: false });
    const subtypes = await getStampSubtypes(userId, collectionId);
    assert.equal(subtypes.length, 2);
    assert.equal(subtypes[0].name, "Colour variety");
    assert.equal(subtypes[0].actsAsVariant, true);
    assert.equal(subtypes[0].sortOrder, 0);
    assert.equal(subtypes[1].name, "Error");
    assert.equal(subtypes[1].actsAsVariant, false);
    assert.equal(subtypes[1].sortOrder, 1);
    assert.ok(subtypes.every((s) => !s.isDefault));
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createStampSubtype("wrong-user", collectionId, { name: "X", actsAsVariant: true }),
      /access denied/i
    );
  });
});

describe("updateStampSubtype and setSubtypeActsAsVariant", () => {
  let userId: string;
  let collectionId: string;
  let subtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`us-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `us-${ts}`)).id;
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Paper variety", actsAsVariant: true, isDefault: false, sortOrder: 0 },
    });
    subtypeId = s.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("renames without touching sortOrder or actsAsVariant", async () => {
    await updateStampSubtype(userId, subtypeId, { name: "Watermark variety" });
    const s = await prisma.stampSubtype.findUniqueOrThrow({ where: { id: subtypeId } });
    assert.equal(s.name, "Watermark variety");
    assert.equal(s.actsAsVariant, true);
    assert.equal(s.sortOrder, 0);
  });

  it("flips the actsAsVariant switch", async () => {
    await setSubtypeActsAsVariant(userId, subtypeId, false);
    let s = await prisma.stampSubtype.findUniqueOrThrow({ where: { id: subtypeId } });
    assert.equal(s.actsAsVariant, false);
    await setSubtypeActsAsVariant(userId, subtypeId, true);
    s = await prisma.stampSubtype.findUniqueOrThrow({ where: { id: subtypeId } });
    assert.equal(s.actsAsVariant, true);
  });

  it("throws when subtype does not belong to user", async () => {
    await assert.rejects(
      () => updateStampSubtype("wrong-user", subtypeId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("setDefaultSubtype", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`sd-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `sd-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("moves the default and keeps exactly one (radio semantics)", async () => {
    const a = await prisma.stampSubtype.create({
      data: { collectionId, name: "A", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });
    const b = await prisma.stampSubtype.create({
      data: { collectionId, name: "B", actsAsVariant: true, isDefault: false, sortOrder: 1 },
    });

    await setDefaultSubtype(userId, b.id);

    const subtypes = await getStampSubtypes(userId, collectionId);
    const defaults = subtypes.filter((s) => s.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, b.id);
    assert.equal(subtypes.find((s) => s.id === a.id)?.isDefault, false);
  });
});

describe("deleteStampSubtype", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`ds-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `ds-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes a non-default, unused subtype", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Overprint", actsAsVariant: false, isDefault: false, sortOrder: 5 },
    });
    await deleteStampSubtype(userId, s.id);
    assert.equal(await prisma.stampSubtype.findUnique({ where: { id: s.id } }), null);
  });

  it("refuses to delete the collection default", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Default one", actsAsVariant: true, isDefault: true, sortOrder: 6 },
    });
    await assert.rejects(() => deleteStampSubtype(userId, s.id), SubtypeIsDefaultError);
    await prisma.stampSubtype.update({ where: { id: s.id }, data: { isDefault: false } });
    await prisma.stampSubtype.delete({ where: { id: s.id } });
  });

  it("refuses to delete a subtype assigned to a stamp", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "In use", actsAsVariant: true, isDefault: false, sortOrder: 7 },
    });
    const parent = await prisma.stamp.create({ data: { collectionId, name: "Parent" } });
    const child = await prisma.stamp.create({
      data: { collectionId, parentId: parent.id, subtypeId: s.id, name: "Child" },
    });
    await assert.rejects(() => deleteStampSubtype(userId, s.id), SubtypeInUseError);
    // Cleanup FK before the collection teardown.
    await prisma.stamp.delete({ where: { id: child.id } });
    await prisma.stamp.delete({ where: { id: parent.id } });
    await prisma.stampSubtype.delete({ where: { id: s.id } });
  });

  it("throws when subtype does not belong to user", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Other user", actsAsVariant: true, isDefault: false, sortOrder: 8 },
    });
    await assert.rejects(() => deleteStampSubtype("wrong-user", s.id), /access denied/i);
    await prisma.stampSubtype.delete({ where: { id: s.id } });
  });
});

describe("reorderStampSubtypes", () => {
  let userId: string;
  let collectionId: string;
  let ids: string[];

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`rs-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `rs-${ts}`)).id;
    const created = await Promise.all(
      ["A", "B", "C"].map((n, i) =>
        prisma.stampSubtype.create({
          data: { collectionId, name: n, actsAsVariant: true, isDefault: i === 0, sortOrder: i },
        })
      )
    );
    ids = created.map((s) => s.id);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("rewrites sortOrder to match the given order", async () => {
    const reversed = [...ids].reverse();
    await reorderStampSubtypes(userId, collectionId, reversed);
    const subtypes = await getStampSubtypes(userId, collectionId);
    assert.deepEqual(subtypes.map((s) => s.id), reversed);
    assert.deepEqual(subtypes.map((s) => s.sortOrder), [0, 1, 2]);
  });

  it("throws when the id list does not match the collection", async () => {
    await assert.rejects(
      () => reorderStampSubtypes(userId, collectionId, [ids[0], ids[1]]),
      /does not match/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => reorderStampSubtypes("wrong-user", collectionId, ids),
      /access denied/i
    );
  });
});

describe("seedDefaultSubtypes via createCollection", () => {
  let userId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`seed-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("seeds the default subtype set on new collections in order with one default", async () => {
    const collection = await createCollection(userId, "Seeded Subtypes", "EUR");
    const subtypes = await getStampSubtypes(userId, collection.id);
    assert.equal(subtypes.length, DEFAULT_STAMP_SUBTYPES.length);
    assert.deepEqual(
      subtypes.map((s) => s.name),
      DEFAULT_STAMP_SUBTYPES.map((s) => s.name)
    );
    assert.deepEqual(
      subtypes.map((s) => s.actsAsVariant),
      DEFAULT_STAMP_SUBTYPES.map((s) => s.actsAsVariant)
    );
    const defaults = subtypes.filter((s) => s.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].name, "Variant");
  });

  it("seedDefaultSubtypes inserts directly for a collection", async () => {
    const collection = await createTestCollection(userId, `direct-${Date.now()}`);
    await seedDefaultSubtypes(collection.id, prisma);
    const subtypes = await getStampSubtypes(userId, collection.id);
    assert.equal(subtypes.length, DEFAULT_STAMP_SUBTYPES.length);
    assert.equal(subtypes[0].name, DEFAULT_STAMP_SUBTYPES[0].name);
  });
});
