import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getCollectionAreas,
  createCollectionArea,
  updateCollectionArea,
  deleteCollectionArea,
  syncAreaCatalogEntries,
} from "../../src/lib/areas";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-areas-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-areas-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-areas-${suffix}`, name: `Collection ${suffix}`, ownerId },
  });
}

describe("getCollectionAreas", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`gca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `gca-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns empty array for a new collection", async () => {
    const areas = await getCollectionAreas(userId, collectionId);
    assert.equal(areas.length, 0);
  });

  it("returns all areas for the collection", async () => {
    const ts = Date.now();
    await prisma.collectionArea.createMany({
      data: [
        { collectionId, name: `Europe-${ts}` },
        { collectionId, name: `Asia-${ts}` },
      ],
    });
    const areas = await getCollectionAreas(userId, collectionId);
    assert.ok(areas.length >= 2);
    assert.ok(areas.every((a) => a.id && a.name));
  });

  it("returns correct childCount", async () => {
    const ts = Date.now();
    const parent = await prisma.collectionArea.create({
      data: { collectionId, name: `Parent-${ts}` },
    });
    await prisma.collectionArea.create({
      data: { collectionId, name: `Child-${ts}`, parentId: parent.id },
    });
    const areas = await getCollectionAreas(userId, collectionId);
    const parentData = areas.find((a) => a.id === parent.id);
    assert.ok(parentData);
    assert.equal(parentData.childCount, 1);
  });

  it("returns correct stampCount", async () => {
    const ts = Date.now();
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: `Stamped-${ts}` },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test" } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id },
    });
    const areas = await getCollectionAreas(userId, collectionId);
    const areaData = areas.find((a) => a.id === area.id);
    assert.ok(areaData);
    assert.equal(areaData.stampCount, 1);
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => getCollectionAreas("wrong-user", collectionId),
      /access denied/i
    );
  });
});

describe("createCollectionArea", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cca-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a top-level area with name only", async () => {
    await createCollectionArea(userId, collectionId, { name: "Europe" });
    const found = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "Europe" },
    });
    assert.ok(found);
    assert.equal(found.parentId, null);
    assert.equal(found.description, null);
    assert.equal(found.primaryCatalogNameId, null);
  });

  it("creates an area with all optional fields", async () => {
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Deutschland", currency: "EUR" },
    });
    await createCollectionArea(userId, collectionId, {
      name: "Germany",
      description: "German stamps",
      primaryCatalogNameId: catalogName.id,
    });
    const found = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "Germany" },
    });
    assert.ok(found);
    assert.equal(found.description, "German stamps");
    assert.equal(found.primaryCatalogNameId, catalogName.id);
  });

  it("creates a child area with parentId", async () => {
    const parent = await prisma.collectionArea.create({
      data: { collectionId, name: "ParentArea" },
    });
    await createCollectionArea(userId, collectionId, {
      name: "ChildArea",
      parentId: parent.id,
    });
    const found = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "ChildArea" },
    });
    assert.ok(found);
    assert.equal(found.parentId, parent.id);
  });

  it("throws when parentId references area in a different collection", async () => {
    const otherUser = await createTestUser(`cca-other-${Date.now()}`);
    const otherCollection = await createTestCollection(otherUser.id, `cca-other-${Date.now()}`);
    const otherArea = await prisma.collectionArea.create({
      data: { collectionId: otherCollection.id, name: "Other" },
    });
    await assert.rejects(
      () => createCollectionArea(userId, collectionId, { name: "Bad", parentId: otherArea.id }),
      /parent area not found/i
    );
    await prisma.collection.deleteMany({ where: { ownerId: otherUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createCollectionArea("wrong-user", collectionId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("updateCollectionArea", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`uca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `uca-${ts}`)).id;
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Original", description: "Old desc" },
    });
    areaId = area.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("updates name and description", async () => {
    await updateCollectionArea(userId, areaId, { name: "Updated", description: "New desc" });
    const found = await prisma.collectionArea.findUniqueOrThrow({ where: { id: areaId } });
    assert.equal(found.name, "Updated");
    assert.equal(found.description, "New desc");
  });

  it("clears optional fields when null is passed", async () => {
    await updateCollectionArea(userId, areaId, { name: "Updated", description: null, primaryCatalogNameId: null });
    const found = await prisma.collectionArea.findUniqueOrThrow({ where: { id: areaId } });
    assert.equal(found.description, null);
    assert.equal(found.primaryCatalogNameId, null);
  });

  it("throws when attempting to create a cycle", async () => {
    const ts = Date.now();
    const a = await prisma.collectionArea.create({ data: { collectionId, name: `CycleA-${ts}` } });
    const b = await prisma.collectionArea.create({ data: { collectionId, name: `CycleB-${ts}`, parentId: a.id } });
    await assert.rejects(
      () => updateCollectionArea(userId, a.id, { name: `CycleA-${ts}`, parentId: b.id }),
      /cannot set an area as its own ancestor/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => updateCollectionArea("wrong-user", areaId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("deleteCollectionArea", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dca-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes an empty area successfully", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "ToDelete" },
    });
    await deleteCollectionArea(userId, area.id);
    const found = await prisma.collectionArea.findUnique({ where: { id: area.id } });
    assert.equal(found, null);
  });

  it("throws when area has child areas", async () => {
    const parent = await prisma.collectionArea.create({
      data: { collectionId, name: "ParentWithChild" },
    });
    await prisma.collectionArea.create({
      data: { collectionId, name: "Child", parentId: parent.id },
    });
    await assert.rejects(
      () => deleteCollectionArea(userId, parent.id),
      /child area/i
    );
  });

  it("throws when area has assigned stamps", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "AreaWithStamps" },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Linked" } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id },
    });
    await assert.rejects(
      () => deleteCollectionArea(userId, area.id),
      /assigned stamp/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Protected" },
    });
    await assert.rejects(
      () => deleteCollectionArea("wrong-user", area.id),
      /access denied/i
    );
  });
});

describe("syncAreaCatalogEntries", () => {
  let userId: string;
  let collectionId: string;
  let catalogNameId: string;
  let catalogName2Id: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`sace-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `sace-${ts}`)).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const cn1 = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Deutschland", currency: "EUR" },
    });
    const cn2 = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Klassik", currency: "EUR" },
    });
    catalogNameId = cn1.id;
    catalogName2Id = cn2.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates catalog entries and reads them back via getCollectionAreas", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, { name: "SynTest" });
    await syncAreaCatalogEntries(userId, areaId, [
      { catalogNameId, prefix: "1" },
      { catalogNameId: catalogName2Id, prefix: null },
    ]);
    const areas = await getCollectionAreas(userId, collectionId);
    const area = areas.find((a) => a.id === areaId);
    assert.ok(area);
    assert.equal(area.catalogEntries.length, 2);
    const e1 = area.catalogEntries.find((e) => e.catalogNameId === catalogNameId);
    assert.ok(e1);
    assert.equal(e1.prefix, "1");
    const e2 = area.catalogEntries.find((e) => e.catalogNameId === catalogName2Id);
    assert.ok(e2);
    assert.equal(e2.prefix, null);
  });

  it("replaces all existing entries on re-sync", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, { name: "ReplaceTest" });
    await syncAreaCatalogEntries(userId, areaId, [{ catalogNameId, prefix: "old" }]);
    await syncAreaCatalogEntries(userId, areaId, [{ catalogNameId: catalogName2Id, prefix: "new" }]);
    const areas = await getCollectionAreas(userId, collectionId);
    const area = areas.find((a) => a.id === areaId);
    assert.ok(area);
    assert.equal(area.catalogEntries.length, 1);
    assert.equal(area.catalogEntries[0].catalogNameId, catalogName2Id);
    assert.equal(area.catalogEntries[0].prefix, "new");
  });

  it("syncing with empty array removes all entries", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, { name: "ClearTest" });
    await syncAreaCatalogEntries(userId, areaId, [{ catalogNameId, prefix: "x" }]);
    await syncAreaCatalogEntries(userId, areaId, []);
    const areas = await getCollectionAreas(userId, collectionId);
    const area = areas.find((a) => a.id === areaId);
    assert.ok(area);
    assert.equal(area.catalogEntries.length, 0);
  });

  it("throws when catalogNameId belongs to a different collection", async () => {
    const otherUser = await createTestUser(`sace-other-${Date.now()}`);
    const otherCollection = await createTestCollection(otherUser.id, `sace-other-${Date.now()}`);
    const otherVendor = await prisma.catalogVendor.create({
      data: { collectionId: otherCollection.id, name: "Scott", abbreviation: "Sc" },
    });
    const otherCn = await prisma.catalogName.create({
      data: { vendorId: otherVendor.id, name: "USA", currency: "USD" },
    });
    const { id: areaId } = await createCollectionArea(userId, collectionId, { name: "BadCatalog" });
    await assert.rejects(
      () => syncAreaCatalogEntries(userId, areaId, [{ catalogNameId: otherCn.id, prefix: null }]),
      /catalog name not found/i
    );
    await prisma.collection.deleteMany({ where: { ownerId: otherUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("throws when collection is not owned by user", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, { name: "AuthTest" });
    await assert.rejects(
      () => syncAreaCatalogEntries("wrong-user", areaId, []),
      /access denied/i
    );
  });
});
