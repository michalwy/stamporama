import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemLocationGroups, listItemsPaginated } from "../../src/lib/items";
import { NO_LOCATION, NO_LOCATION_REF } from "../../src/lib/location-groups";

// Grouping the Copies list by where its copies are filed (#421). What is worth pinning down here is
// what the pure half cannot answer: that a nested location is its **own** group rather than rolled
// into its parent, that the unfiled and unlabelled buckets are real groups, that the panel's filters
// still narrow the counts, and that the group's own filters address exactly the copies it counted.

const ts = Date.now();

describe("location groups", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let cupboardId: string;
  let klaserAId: string;
  let klaserBId: string;

  before(async () => {
    userId = `test-user-locgroups-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User locgroups-${ts}`,
        email: `test-locgroups-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-locgroups-${ts}`, name: "Loc", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;

    cupboardId = (
      await prisma.location.create({
        data: { collectionId, name: "Szafa 1", assignable: true },
      })
    ).id;
    klaserAId = (
      await prisma.location.create({
        data: { collectionId, name: "Klaser A", parentId: cupboardId, assignable: true },
      })
    ).id;
    klaserBId = (
      await prisma.location.create({
        data: { collectionId, name: "Klaser B", parentId: cupboardId, assignable: true },
      })
    ).id;

    const base = { stampId, conditionId };
    // Klaser A: three copies over two refs, one of them unlabelled.
    await createItem(userId, collectionId, { ...base, locationId: klaserAId, locationRef: "A10" });
    await createItem(userId, collectionId, { ...base, locationId: klaserAId, locationRef: "A2" });
    await createItem(userId, collectionId, { ...base, locationId: klaserAId });
    // Klaser B: one copy, and one for sale so a filter has something to narrow to.
    await createItem(userId, collectionId, { ...base, locationId: klaserBId, locationRef: "B1" });
    await createItem(userId, collectionId, {
      ...base,
      locationId: klaserBId,
      locationRef: "B1",
      forSale: true,
    });
    // Straight into the cupboard itself — its own group, never merged with the klasers under it.
    await createItem(userId, collectionId, { ...base, locationId: cupboardId });
    // Filed nowhere.
    await createItem(userId, collectionId, { ...base });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.location.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("groups by location exactly, in shelf order, with the unfiled copies last", async () => {
    const { groups } = await listItemLocationGroups(userId, collectionId);
    assert.deepEqual(
      groups.map((g) => [g.locationPath, g.count]),
      [
        ["Szafa 1", 1],
        ["Szafa 1 › Klaser A", 3],
        ["Szafa 1 › Klaser B", 2],
        [null, 1],
      ]
    );
    // The parent counts only what is filed *in* it — a roll-up would report one copy twice.
    assert.equal(groups[0].locationName, "Szafa 1");
    assert.equal(groups[3].locationId, null);
  });

  it("splits a location by ref, blanks last", async () => {
    const { groups } = await listItemLocationGroups(userId, collectionId, { by: "ref" });
    const klaserA = groups.filter((g) => g.locationPath === "Szafa 1 › Klaser A");
    assert.deepEqual(
      klaserA.map((g) => [g.locationRef, g.count]),
      [
        ["A2", 1],
        ["A10", 1],
        [null, 1],
      ]
    );
    // Two copies sharing a ref are one group.
    const klaserB = groups.filter((g) => g.locationPath === "Szafa 1 › Klaser B");
    assert.deepEqual(
      klaserB.map((g) => [g.locationRef, g.count]),
      [["B1", 2]]
    );
  });

  it("counts the filtered set, not the whole collection", async () => {
    const { groups } = await listItemLocationGroups(userId, collectionId, { forSale: true });
    assert.deepEqual(
      groups.map((g) => [g.locationPath, g.count]),
      [["Szafa 1 › Klaser B", 1]]
    );
  });

  it("pages over a total order", async () => {
    const first = await listItemLocationGroups(userId, collectionId, { pageSize: 2 });
    assert.equal(first.groups.length, 2);
    assert.equal(first.nextCursor, "2");
    const second = await listItemLocationGroups(userId, collectionId, {
      pageSize: 2,
      offset: 2,
    });
    assert.equal(second.nextCursor, null);
    const seen = [...first.groups, ...second.groups].map((g) => g.key);
    assert.equal(new Set(seen).size, 4);
  });

  it("addresses its own members with the location pinned exactly", async () => {
    const { groups } = await listItemLocationGroups(userId, collectionId);
    const cupboard = groups.find((g) => g.locationId === cupboardId)!;
    const members = await listItemsPaginated(userId, collectionId, {
      locationId: cupboard.locationId!,
      locationExact: true,
    });
    assert.equal(members.items.length, cupboard.count);

    const unfiled = groups.find((g) => g.locationId === null)!;
    const unfiledMembers = await listItemsPaginated(userId, collectionId, {
      locationId: NO_LOCATION,
      locationExact: true,
    });
    assert.equal(unfiledMembers.items.length, unfiled.count);
    assert.equal(unfiledMembers.items.every((i) => i.locationId === null), true);
  });

  it("addresses an unlabelled ref group's members", async () => {
    const members = await listItemsPaginated(userId, collectionId, {
      locationId: klaserAId,
      locationExact: true,
      locationRef: NO_LOCATION_REF,
    });
    assert.equal(members.items.length, 1);
    assert.equal(members.items[0].locationRef, null);

    const labelled = await listItemsPaginated(userId, collectionId, {
      locationId: klaserAId,
      locationExact: true,
      locationRef: "A10",
    });
    assert.equal(labelled.items.length, 1);
    assert.equal(labelled.items[0].locationRef, "A10");
  });
});
