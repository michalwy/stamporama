import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createCollection,
  getCollectionsByOwner,
  getCollectionBySlug,
} from "../../src/lib/collections";
import { wipeDemoData } from "../../src/lib/demo/index";
import { prisma } from "../../src/lib/db";

// Creates a minimal user row for test isolation.
async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("createCollection", () => {
  let userId: string;

  before(async () => {
    const u = await createTestUser(`cc-${Date.now()}`);
    userId = u.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a collection with the correct name and owner", async () => {
    const c = await createCollection(userId, "My Test Collection");
    assert.equal(c.name, "My Test Collection");
    assert.equal(typeof c.slug, "string");
    assert.ok(c.slug.length > 0);
    assert.equal(typeof c.id, "string");
  });

  it("generates a slug from the name", async () => {
    const c = await createCollection(userId, "Airmail Stamps");
    assert.equal(c.slug, "airmail-stamps");
  });

  it("appends -2 suffix when slug already exists for the same user", async () => {
    const first = await createCollection(userId, "Duplicated Name");
    const second = await createCollection(userId, "Duplicated Name");
    assert.equal(first.slug, "duplicated-name");
    assert.equal(second.slug, "duplicated-name-2");
  });

  it("rejects an empty name", async () => {
    await assert.rejects(
      () => createCollection(userId, "   "),
      /required/i
    );
  });

  it("strips special characters in the slug", async () => {
    const c = await createCollection(userId, "Stamps & Coins!");
    assert.equal(c.slug, "stamps-coins");
  });
});

describe("createCollection — cross-user isolation", () => {
  let userA: string;
  let userB: string;

  before(async () => {
    const ts = Date.now();
    userA = (await createTestUser(`xa-${ts}`)).id;
    userB = (await createTestUser(`xb-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userA, userB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  });

  it("allows the same slug for different users", async () => {
    const a = await createCollection(userA, "Airmail");
    const b = await createCollection(userB, "Airmail");
    assert.equal(a.slug, "airmail");
    assert.equal(b.slug, "airmail");
  });
});

describe("getCollectionsByOwner", () => {
  let userId: string;

  before(async () => {
    userId = (await createTestUser(`gco-${Date.now()}`)).id;
    await createCollection(userId, "First");
    await createCollection(userId, "Second");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns all collections for the owner", async () => {
    const cols = await getCollectionsByOwner(userId);
    assert.ok(cols.length >= 2);
  });

  it("does not return collections belonging to other users", async () => {
    const other = await createTestUser(`gcoo-${Date.now()}`);
    await createCollection(other.id, "Other User Collection");
    try {
      const cols = await getCollectionsByOwner(userId);
      for (const c of cols) {
        assert.notEqual(c.id, "Other User Collection");
      }
    } finally {
      await prisma.collection.deleteMany({ where: { ownerId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});

describe("getCollectionBySlug", () => {
  let userId: string;
  let slug: string;

  before(async () => {
    userId = (await createTestUser(`gcbs-${Date.now()}`)).id;
    const c = await createCollection(userId, "Slug Test");
    slug = c.slug;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns the collection when slug and owner match", async () => {
    const c = await getCollectionBySlug(userId, slug);
    assert.ok(c !== null);
    assert.equal(c!.slug, slug);
  });

  it("returns null for a nonexistent slug", async () => {
    const c = await getCollectionBySlug(userId, "does-not-exist");
    assert.equal(c, null);
  });

  it("returns null when slug belongs to a different user", async () => {
    const other = await createTestUser(`gcbso-${Date.now()}`);
    try {
      const c = await getCollectionBySlug(other.id, slug);
      assert.equal(c, null);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});

describe("createCollection — seedDemo option", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    userId = (await createTestUser(`sd-${Date.now()}`)).id;
    const c = await createCollection(userId, "Demo Collection", { seedDemo: true });
    collectionId = c.id;
  });

  after(async () => {
    await prisma.$transaction((tx) => wipeDemoData(collectionId, tx as never));
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("seeds at least one catalog vendor", async () => {
    const vendors = await prisma.catalogVendor.findMany({ where: { collectionId } });
    assert.ok(vendors.length >= 1);
  });

  it("seeds at least one collection area", async () => {
    const areas = await prisma.collectionArea.findMany({ where: { collectionId } });
    assert.ok(areas.length >= 1);
  });
});
