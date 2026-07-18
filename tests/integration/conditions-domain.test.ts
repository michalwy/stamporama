import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getStampConditions,
  createStampCondition,
  updateStampCondition,
  deleteStampCondition,
  reorderStampConditions,
  seedDefaultConditions,
  DEFAULT_CONDITIONS,
} from "../../src/lib/conditions";
import { createCollection } from "../../src/lib/collections";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-cond-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-cond-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-cond-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("createStampCondition", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cc-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("appends conditions with increasing sortOrder", async () => {
    await createStampCondition(userId, collectionId, { name: "Mint Never Hinged", abbreviation: "MNH" });
    await createStampCondition(userId, collectionId, { name: "Used", abbreviation: "U" });
    const conditions = await getStampConditions(userId, collectionId);
    assert.equal(conditions.length, 2);
    assert.equal(conditions[0].abbreviation, "MNH");
    assert.equal(conditions[0].sortOrder, 0);
    assert.equal(conditions[1].abbreviation, "U");
    assert.equal(conditions[1].sortOrder, 1);
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createStampCondition("wrong-user", collectionId, { name: "X", abbreviation: "X" }),
      /access denied/i
    );
  });
});

describe("updateStampCondition", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`uc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `uc-${ts}`)).id;
    const c = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Hinged", abbreviation: "MH", sortOrder: 0 },
    });
    conditionId = c.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("updates name and abbreviation without touching sortOrder", async () => {
    await updateStampCondition(userId, conditionId, { name: "Mint No Gum", abbreviation: "MNG" });
    const c = await prisma.stampCondition.findUniqueOrThrow({ where: { id: conditionId } });
    assert.equal(c.name, "Mint No Gum");
    assert.equal(c.abbreviation, "MNG");
    assert.equal(c.sortOrder, 0);
  });

  it("throws when condition does not belong to user", async () => {
    await assert.rejects(
      () => updateStampCondition("wrong-user", conditionId, { name: "X", abbreviation: "X" }),
      /access denied/i
    );
  });
});

describe("deleteStampCondition", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dc-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes a condition", async () => {
    const c = await prisma.stampCondition.create({
      data: { collectionId, name: "Cancelled to Order", abbreviation: "CTO", sortOrder: 0 },
    });
    await deleteStampCondition(userId, c.id);
    const found = await prisma.stampCondition.findUnique({ where: { id: c.id } });
    assert.equal(found, null);
  });

  it("throws when condition does not belong to user", async () => {
    const c = await prisma.stampCondition.create({
      data: { collectionId, name: "First Day Cover", abbreviation: "FDC", sortOrder: 1 },
    });
    await assert.rejects(
      () => deleteStampCondition("wrong-user", c.id),
      /access denied/i
    );
  });
});

describe("reorderStampConditions", () => {
  let userId: string;
  let collectionId: string;
  let ids: string[];

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`rc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `rc-${ts}`)).id;
    const created = await Promise.all(
      ["A", "B", "C"].map((n, i) =>
        prisma.stampCondition.create({
          data: { collectionId, name: n, abbreviation: n, sortOrder: i },
        })
      )
    );
    ids = created.map((c) => c.id);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("rewrites sortOrder to match the given order", async () => {
    const reversed = [...ids].reverse();
    await reorderStampConditions(userId, collectionId, reversed);
    const conditions = await getStampConditions(userId, collectionId);
    assert.deepEqual(conditions.map((c) => c.id), reversed);
    assert.deepEqual(conditions.map((c) => c.sortOrder), [0, 1, 2]);
  });

  it("throws when the id list does not match the collection", async () => {
    await assert.rejects(
      () => reorderStampConditions(userId, collectionId, [ids[0], ids[1]]),
      /does not match/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => reorderStampConditions("wrong-user", collectionId, ids),
      /access denied/i
    );
  });
});

describe("seedDefaultConditions via createCollection", () => {
  let userId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`seed-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("seeds the default condition set on new collections in order", async () => {
    const collection = await createCollection(userId, "Seeded Collection", "EUR");
    const conditions = await getStampConditions(userId, collection.id);
    assert.equal(conditions.length, DEFAULT_CONDITIONS.length);
    assert.deepEqual(
      conditions.map((c) => c.abbreviation),
      DEFAULT_CONDITIONS.map((c) => c.abbreviation)
    );
    assert.deepEqual(
      conditions.map((c) => c.sortOrder),
      DEFAULT_CONDITIONS.map((_, i) => i)
    );
  });

  it("seedDefaultConditions inserts directly for a collection", async () => {
    const collection = await createTestCollection(userId, `direct-${Date.now()}`);
    // Collection created outside createCollection has no conditions yet.
    await seedDefaultConditions(collection.id, prisma);
    const conditions = await getStampConditions(userId, collection.id);
    assert.equal(conditions.length, DEFAULT_CONDITIONS.length);
    assert.equal(conditions[0].abbreviation, DEFAULT_CONDITIONS[0].abbreviation);
  });
});
