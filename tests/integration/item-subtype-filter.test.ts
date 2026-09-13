import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated, listItemYearFacets } from "../../src/lib/items";

// The Copies list's subtype filter (#1002; ADR-0049 §7). Subtype is the one axis of the multi-value
// filters that lives on the linked **stamp** rather than on the copy, and like format and certificate
// its null is a value: a base stamp carries no subtype (ADR-0010 §2). The question worth pinning is the
// one the filter was asked for — *everything but the forgeries* — which is only answerable if ticking
// `none` beside the other subtypes keeps the base stamps' copies.

const ts = Date.now();

describe("subtype copy filter", () => {
  let userId: string;
  let collectionId: string;
  let variantId: string;
  let forgeryId: string;
  let errorId: string;
  let mnhId: string;
  let usedId: string;

  before(async () => {
    userId = `test-user-subtypefilter-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User subtypefilter-${ts}`,
        email: `test-subtypefilter-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-subtypefilter-${ts}`, name: "SF", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const subtype = async (name: string, actsAsVariant: boolean, sortOrder: number) =>
      (
        await prisma.stampSubtype.create({
          data: { collectionId, name, actsAsVariant, isDefault: sortOrder === 0, sortOrder },
        })
      ).id;
    variantId = await subtype("Variant", true, 0);
    errorId = await subtype("Error", false, 1);
    forgeryId = await subtype("Forgery", false, 2);

    const condition = async (name: string, abbreviation: string, sortOrder: number) =>
      (await prisma.stampCondition.create({ data: { collectionId, name, abbreviation, sortOrder } }))
        .id;
    mnhId = await condition("Mint never hinged", "MNH", 0);
    usedId = await condition("Used", "U", 1);

    const base = await prisma.stamp.create({
      data: { collectionId, name: "Chopin", issuedYear: 1927 },
    });
    const child = async (name: string, subtypeId: string) =>
      (
        await prisma.stamp.create({
          data: { collectionId, name, parentId: base.id, subtypeId, issuedYear: 1927 },
        })
      ).id;
    const variantStamp = await child("Chopin a", variantId);
    const errorStamp = await child("Chopin inverted centre", errorId);
    const forgeryStamp = await child("Chopin forgery", forgeryId);

    // Two copies of the base stamp, one of each child.
    await createItem(userId, collectionId, { stampId: base.id, conditionId: mnhId });
    await createItem(userId, collectionId, { stampId: base.id, conditionId: usedId });
    await createItem(userId, collectionId, { stampId: variantStamp, conditionId: mnhId });
    await createItem(userId, collectionId, { stampId: errorStamp, conditionId: usedId });
    await createItem(userId, collectionId, { stampId: forgeryStamp, conditionId: usedId });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampSubtype.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const count = async (filters: Parameters<typeof listItemsPaginated>[2]) =>
    (await listItemsPaginated(userId, collectionId, { ...filters, pageSize: 100 })).items.length;

  it("matches any of several subtypes", async () => {
    assert.equal(await count({ subtypeIds: [forgeryId] }), 1);
    assert.equal(await count({ subtypeIds: [errorId, forgeryId] }), 2);
    // An empty list is the absence of the filter, never an unmatchable empty set.
    assert.equal(await count({ subtypeIds: [] }), 5);
  });

  it("reads `none` as a base stamp, alone and alongside a subtype", async () => {
    assert.equal(await count({ subtypeIds: ["none"] }), 2);
    assert.equal(await count({ subtypeIds: ["none", errorId] }), 3);
  });

  it("answers *everything but the forgeries* without losing the base stamps", async () => {
    assert.equal(await count({ subtypeIds: ["none", variantId, errorId] }), 4);
    const rows = await listItemsPaginated(userId, collectionId, {
      subtypeIds: ["none", variantId, errorId],
      pageSize: 100,
    });
    assert.ok(rows.items.every((row) => row.stampName !== "Chopin forgery"));
  });

  it("composes with the search and the other axes rather than replacing them", async () => {
    assert.equal(await count({ subtypeIds: ["none"], conditionIds: [usedId] }), 1);
    assert.equal(await count({ subtypeIds: ["none", forgeryId], conditionIds: [usedId] }), 2);
    // The search is an `OR` too; both have to narrow, neither may swallow the other.
    assert.equal(await count({ subtypeIds: ["none", forgeryId], search: "forgery" }), 1);
  });

  it("narrows the year facet the list's rail reads", async () => {
    const years = await listItemYearFacets(userId, collectionId, { subtypeIds: [forgeryId] });
    assert.deepEqual(
      years.map((y) => [y.year, y.count]),
      [[1927, 1]]
    );
  });
});
