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

  // #385: the subtree is the default reading, not the only one. "This location only" answers
  // "what is loose in the cabinet itself" — the copies filed on the node, none of its children's.
  it("narrows to the location alone when the scope is exact", async () => {
    const cabinet = await createLocation(f.userId, f.collectionId, {
      name: "Cabinet 3",
      assignable: true,
    });
    const book = await createLocation(f.userId, f.collectionId, {
      name: "Book 3",
      parentId: cabinet.id,
    });
    await createItem(f.userId, f.collectionId, {
      stampId: f.stamp.id,
      conditionId: f.condition.id,
      locationId: cabinet.id,
      locationRef: "loose",
    });
    await createItem(f.userId, f.collectionId, {
      stampId: f.stamp.id,
      conditionId: f.condition.id,
      locationId: book.id,
      locationRef: "p.2",
    });

    const subtree = await listItemsPaginated(f.userId, f.collectionId, {
      locationId: cabinet.id,
    });
    const refs = subtree.items.map((i) => i.locationRef);
    assert.ok(refs.includes("loose") && refs.includes("p.2"), "the subtree holds both");

    const exact = await listItemsPaginated(f.userId, f.collectionId, {
      locationId: cabinet.id,
      locationExact: true,
    });
    const exactRefs = exact.items.map((i) => i.locationRef);
    assert.ok(exactRefs.includes("loose"), "the copy on the node itself stays");
    assert.ok(!exactRefs.includes("p.2"), "the child book's copy is dropped");
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

describe("location codes (#2191, per level since #2235)", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`codes-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  async function codesOf(id: string): Promise<{ code: string; fullCode: string }> {
    const location = (await getLocations(f.userId, f.collectionId)).find((l) => l.id === id)!;
    return { code: location.code, fullCode: location.fullCode };
  }

  it("suggests a level's code from its own name when none is given, numbering a sibling clash", async () => {
    const segment = await createLocation(f.userId, f.collectionId, {
      name: "Segment A",
      assignable: false,
    });
    const shelf = await createLocation(f.userId, f.collectionId, {
      name: "Shelf B",
      parentId: segment.id,
      assignable: false,
    });
    const book = await createLocation(f.userId, f.collectionId, {
      name: "Stockbook X",
      parentId: shelf.id,
    });
    const twin = await createLocation(f.userId, f.collectionId, {
      name: "Stockbook Xenia",
      parentId: shelf.id,
    });
    assert.deepEqual(await codesOf(segment.id), { code: "A", fullCode: "A" });
    assert.deepEqual(await codesOf(shelf.id), { code: "B", fullCode: "A.B" });
    assert.deepEqual(await codesOf(book.id), { code: "X", fullCode: "A.B.X" });
    assert.deepEqual(await codesOf(twin.id), { code: "X2", fullCode: "A.B.X2" });
  });

  it("keeps a typed code as typed and lets cousins share it", async () => {
    const first = await createLocation(f.userId, f.collectionId, { name: "Box 1", code: " k1 " });
    const second = await createLocation(f.userId, f.collectionId, { name: "Box 2", code: "Box two" });
    const a = await createLocation(f.userId, f.collectionId, {
      name: "Page",
      parentId: first.id,
      code: "1",
    });
    const b = await createLocation(f.userId, f.collectionId, {
      name: "Page",
      parentId: second.id,
      code: "1",
    });
    assert.deepEqual(await codesOf(a.id), { code: "1", fullCode: "k1.1" });
    assert.deepEqual(await codesOf(b.id), { code: "1", fullCode: "Box two.1" });
  });

  it("refuses a sibling's code whatever its case, naming the sibling, and a dot or a blank", async () => {
    await assert.rejects(
      () => createLocation(f.userId, f.collectionId, { name: "Other", code: "K1" }),
      /Code K1 is already used by Box 1\./
    );
    const shelf = (await getLocations(f.userId, f.collectionId)).find((l) => l.name === "Shelf B")!;
    await assert.rejects(
      () => createLocation(f.userId, f.collectionId, { name: "Other", parentId: shelf.id, code: "x" }),
      /Code x is already used by Segment A › Shelf B › Stockbook X\./
    );
    await assert.rejects(
      () => createLocation(f.userId, f.collectionId, { name: "Other", code: "A.1" }),
      /dot/
    );
    await assert.rejects(
      () => createLocation(f.userId, f.collectionId, { name: "Other", code: "  " }),
      /Code is required/
    );
  });

  it("holds the sibling rule in the database too", async () => {
    await assert.rejects(
      () =>
        prisma.location.create({
          data: { collectionId: f.collectionId, name: "Raw", code: "K1" },
        }),
      (err: unknown) => (err as { code?: string }).code === "P2002"
    );
  });

  it("follows a move and a parent's new code at once, and refuses a move onto a sibling's code", async () => {
    const drawer = await createLocation(f.userId, f.collectionId, { name: "Drawer 7" });
    const tray = await createLocation(f.userId, f.collectionId, { name: "Tray", code: "T" });
    const card = await createLocation(f.userId, f.collectionId, {
      name: "Card",
      parentId: drawer.id,
      code: "c",
    });
    assert.deepEqual(await codesOf(card.id), { code: "c", fullCode: "7.c" });

    await updateLocation(f.userId, drawer.id, { name: "Drawer 8", parentId: tray.id });
    assert.deepEqual(await codesOf(drawer.id), { code: "7", fullCode: "T.7" });
    assert.deepEqual(await codesOf(card.id), { code: "c", fullCode: "T.7.c" });

    await updateLocation(f.userId, tray.id, { name: "Tray", code: "Tr" });
    assert.deepEqual(await codesOf(card.id), { code: "c", fullCode: "Tr.7.c" });

    const other = await createLocation(f.userId, f.collectionId, { name: "Other", code: "c" });
    await assert.rejects(
      () => updateLocation(f.userId, other.id, { name: "Other", parentId: drawer.id }),
      /Code c is already used by Tray › Drawer 8 › Card\./
    );
    await assert.rejects(
      () => updateLocation(f.userId, drawer.id, { name: "Drawer 8", parentId: tray.id, code: "" }),
      /Code is required/
    );
    assert.deepEqual(await codesOf(drawer.id), { code: "7", fullCode: "Tr.7" });
  });

  it("lets two collections use the same code", async () => {
    const other = await seedFixtures(`codes-other-${Date.now()}`);
    await createLocation(other.userId, other.collectionId, { name: "Box", code: "k1" });
    await cleanup(other.userId);
  });
});
