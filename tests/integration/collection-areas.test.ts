import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";

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

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: {
      slug: `col-${suffix}`,
      name: `Collection ${suffix}`,
      baseCurrency: "EUR",
      ownerId,
    },
  });
}

describe("CollectionArea persistence", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    const u = await createTestUser(`ca-${ts}`);
    userId = u.id;
    const c = await createTestCollection(userId, `ca-${ts}`);
    collectionId = c.id;
  });

  after(async () => {
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a top-level collection area", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Europe" },
    });
    assert.equal(area.name, "Europe");
    assert.equal(area.collectionId, collectionId);
    assert.equal(area.parentId, null);
    assert.equal(area.description, null);
    assert.equal(area.catalogId, null);
    assert.ok(area.createdAt instanceof Date);
  });

  it("creates a child area referencing a parent", async () => {
    const parent = await prisma.collectionArea.create({
      data: { collectionId, name: "Asia" },
    });
    const child = await prisma.collectionArea.create({
      data: { collectionId, name: "Japan", parentId: parent.id },
    });
    assert.equal(child.parentId, parent.id);
  });

  it("stores optional description and catalogId", async () => {
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Americas",
        description: "North and South America",
        catalogId: "scott-us",
      },
    });
    assert.equal(area.description, "North and South America");
    assert.equal(area.catalogId, "scott-us");
  });

  it("cascades delete when collection is deleted", async () => {
    const ts = Date.now();
    const u2 = await createTestUser(`ca-del-${ts}`);
    const c2 = await createTestCollection(u2.id, `ca-del-${ts}`);
    await prisma.collectionArea.create({ data: { collectionId: c2.id, name: "ToDelete" } });

    await prisma.collection.delete({ where: { id: c2.id } });
    await prisma.user.delete({ where: { id: u2.id } });

    const remaining = await prisma.collectionArea.findMany({ where: { collectionId: c2.id } });
    assert.equal(remaining.length, 0);
  });
});

describe("StampCollectionArea persistence", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let sharedStampId: string;

  before(async () => {
    const ts = Date.now();
    const u = await createTestUser(`sca-${ts}`);
    userId = u.id;
    const c = await createTestCollection(userId, `sca-${ts}`);
    collectionId = c.id;
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Test Area" },
    });
    areaId = area.id;
    const stamp = await prisma.stamp.create({ data: { collectionId } });
    sharedStampId = stamp.id;
  });

  after(async () => {
    await prisma.stampCollectionArea.deleteMany({ where: { collectionAreaId: areaId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a stamp-area link with isPrimary false by default", async () => {
    const link = await prisma.stampCollectionArea.create({
      data: { stampId: sharedStampId, collectionAreaId: areaId },
    });
    assert.equal(link.stampId, sharedStampId);
    assert.equal(link.collectionAreaId, areaId);
    assert.equal(link.isPrimary, false);
  });

  it("creates a stamp-area link with isPrimary true", async () => {
    const stamp = await prisma.stamp.create({ data: { collectionId } });
    const link = await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
    });
    assert.equal(link.isPrimary, true);
  });

  it("enforces composite primary key uniqueness", async () => {
    const stamp = await prisma.stamp.create({ data: { collectionId } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: areaId },
    });
    await assert.rejects(
      () => prisma.stampCollectionArea.create({ data: { stampId: stamp.id, collectionAreaId: areaId } }),
    );
  });

  it("cascades delete when collection area is deleted", async () => {
    const ts = Date.now();
    const tmpArea = await prisma.collectionArea.create({
      data: { collectionId, name: `TmpArea-${ts}` },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: tmpArea.id },
    });

    await prisma.collectionArea.delete({ where: { id: tmpArea.id } });

    const links = await prisma.stampCollectionArea.findMany({
      where: { collectionAreaId: tmpArea.id },
    });
    assert.equal(links.length, 0);
  });
});
