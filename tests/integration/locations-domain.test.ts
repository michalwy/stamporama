import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getLocations,
  createLocation,
  updateLocation,
  deleteLocation,
} from "../../src/lib/locations";
import { createItem, listItemsPaginated } from "../../src/lib/items";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-loc-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-loc-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-loc-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

async function seedFixtures(suffix: string) {
  const userId = (await createTestUser(suffix)).id;
  const collectionId = (await createTestCollection(userId, suffix)).id;
  const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp 1" } });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  return { userId, collectionId, stamp, condition };
}

async function cleanup(userId: string) {
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("createLocation", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`create-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("defaults assignable to true and nests under a parent", async () => {
    const cabinet = await createLocation(f.userId, f.collectionId, {
      name: "Cabinet",
      assignable: false,
    });
    const shelf = await createLocation(f.userId, f.collectionId, {
      name: "Stockbook",
      parentId: cabinet.id,
    });
    const locations = await getLocations(f.userId, f.collectionId);
    const cab = locations.find((l) => l.id === cabinet.id)!;
    const book = locations.find((l) => l.id === shelf.id)!;
    assert.equal(cab.assignable, false);
    assert.equal(cab.childCount, 1);
    assert.equal(book.assignable, true); // default
    assert.equal(book.parentId, cabinet.id);
  });

  it("rejects a parent from another collection", async () => {
    const other = await seedFixtures(`other-${Date.now()}`);
    const foreign = await createLocation(other.userId, other.collectionId, {
      name: "Foreign",
    });
    await assert.rejects(
      () => createLocation(f.userId, f.collectionId, { name: "X", parentId: foreign.id }),
      /Parent location not found/
    );
    await cleanup(other.userId);
  });
});

describe("updateLocation guards", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`update-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("rejects making itself its own ancestor", async () => {
    const a = await createLocation(f.userId, f.collectionId, { name: "A" });
    const b = await createLocation(f.userId, f.collectionId, { name: "B", parentId: a.id });
    await assert.rejects(
      () => updateLocation(f.userId, a.id, { name: "A", parentId: b.id }),
      /own ancestor/
    );
  });

  it("rejects marking a location non-assignable while copies are stored in it", async () => {
    const loc = await createLocation(f.userId, f.collectionId, { name: "Book" });
    await createItem(f.userId, f.collectionId, {
      stampId: f.stamp.id,
      conditionId: f.condition.id,
      locationId: loc.id,
    });
    await assert.rejects(
      () => updateLocation(f.userId, loc.id, { name: "Book", assignable: false }),
      /non-assignable/
    );
  });
});

describe("assignment validation + subtree filter", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`assign-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("rejects filing a copy into a grouping-only location", async () => {
    const cabinet = await createLocation(f.userId, f.collectionId, {
      name: "Cabinet",
      assignable: false,
    });
    await assert.rejects(
      () =>
        createItem(f.userId, f.collectionId, {
          stampId: f.stamp.id,
          conditionId: f.condition.id,
          locationId: cabinet.id,
        }),
      /cannot hold copies/
    );
  });

  it("filters by a location including its whole subtree", async () => {
    const cabinet = await createLocation(f.userId, f.collectionId, {
      name: "Cabinet 2",
      assignable: false,
    });
    const book = await createLocation(f.userId, f.collectionId, {
      name: "Book",
      parentId: cabinet.id,
    });
    await createItem(f.userId, f.collectionId, {
      stampId: f.stamp.id,
      conditionId: f.condition.id,
      locationId: book.id,
      locationRef: "p.1",
    });
    // Filtering by the parent cabinet returns the copy stored in its child book.
    const bySubtree = await listItemsPaginated(f.userId, f.collectionId, {
      locationId: cabinet.id,
    });
    assert.ok(
      bySubtree.items.some((i) => i.locationId === book.id && i.locationRef === "p.1"),
      "Expected the child-book copy under the parent-cabinet filter"
    );
  });
});

describe("deleteLocation guards", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`delete-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("blocks deleting a location with children, then with copies, then allows it", async () => {
    const parent = await createLocation(f.userId, f.collectionId, { name: "Parent" });
    const child = await createLocation(f.userId, f.collectionId, {
      name: "Child",
      parentId: parent.id,
    });
    await assert.rejects(
      () => deleteLocation(f.userId, parent.id),
      /child location/
    );

    await createItem(f.userId, f.collectionId, {
      stampId: f.stamp.id,
      conditionId: f.condition.id,
      locationId: child.id,
    });
    await assert.rejects(
      () => deleteLocation(f.userId, child.id),
      /stored copies/
    );

    // Detach the copy, then the leaf deletes.
    await prisma.item.updateMany({
      where: { locationId: child.id },
      data: { locationId: null, locationRef: null },
    });
    await deleteLocation(f.userId, child.id);
    const remaining = await getLocations(f.userId, f.collectionId);
    assert.ok(!remaining.some((l) => l.id === child.id));
  });
});
