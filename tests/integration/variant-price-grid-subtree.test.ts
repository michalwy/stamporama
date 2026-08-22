import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getVariantPriceGrid } from "../../src/lib/variant-prices";

// **A grid opened for one copy is a grid over one umbrella** (#679).
//
// A stamp scope resolves up to its tree's root, which is what an entry point opened to work a tree
// *through* wants. An opening made for one copy is a different question: the item being listed is
// one umbrella, and drawing `175 → 175A → 175C → 175D → 175E → 175Ea → 175Eb` in answer to a
// question about `175E` buries the two rows that would unblock the listing under five that have
// nothing to do with it. `subtree` starts the drawn tree at the scope stamp instead.
//
// The area a subtree resolves its editions against comes from the **ancestry**, not from the
// subtree's own root: a variant node need not carry a `StampAreaLink` of its own, and a grid with no
// editions could not be filled in at all.

describe("variant price grid scoped to a subtree (#679)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let rootId: string;
  let siblingId: string;
  let umbrellaId: string;
  let variantAId: string;
  let variantBId: string;
  let catalogNameId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-vpsub-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User vpsub-${ts}`,
        email: `test-vpsub-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-vpsub-${ts}`,
          name: `Collection vpsub-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor.id, name: "Michel Niederlande", currency: "EUR" },
      })
    ).id;
    await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } });

    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Netherlands", primaryCatalogNameId: catalogNameId },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: areaId, catalogNameId },
    });

    await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });

    // Mi·NL 175 → { 175A, 175E → { 175Ea, 175Eb } }. Only the root is filed in the area, which is
    // the ordinary shape and the one that makes the ancestry walk matter.
    rootId = (await prisma.stamp.create({ data: { collectionId, name: "175" } })).id;
    await prisma.stampCollectionArea.create({
      data: { stampId: rootId, collectionAreaId: areaId, isPrimary: true },
    });
    siblingId = (
      await prisma.stamp.create({ data: { collectionId, name: "175A", parentId: rootId } })
    ).id;
    umbrellaId = (
      await prisma.stamp.create({ data: { collectionId, name: "175E", parentId: rootId } })
    ).id;
    variantAId = (
      await prisma.stamp.create({ data: { collectionId, name: "175Ea", parentId: umbrellaId } })
    ).id;
    variantBId = (
      await prisma.stamp.create({ data: { collectionId, name: "175Eb", parentId: umbrellaId } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("draws the whole tree from any node when no subtree is asked for", async () => {
    const grid = await getVariantPriceGrid(userId, { kind: "stamp", stampId: umbrellaId });
    assert.deepEqual(
      grid.rows.map((r) => r.stampId).sort(),
      [rootId, siblingId, umbrellaId, variantAId, variantBId].sort()
    );
    assert.equal(grid.rows[0]?.stampId, rootId);
  });

  it("draws only the umbrella and its own descendants under a subtree scope", async () => {
    const grid = await getVariantPriceGrid(userId, {
      kind: "stamp",
      stampId: umbrellaId,
      subtree: true,
    });
    assert.deepEqual(
      grid.rows.map((r) => r.stampId).sort(),
      [umbrellaId, variantAId, variantBId].sort()
    );
    // The umbrella is the root of what is drawn, and its variants hang one level under it.
    assert.equal(grid.rows[0]?.stampId, umbrellaId);
    assert.equal(grid.rows[0]?.depth, 0);
    assert.deepEqual(
      grid.rows.filter((r) => r.depth === 1).map((r) => r.stampId).sort(),
      [variantAId, variantBId].sort()
    );
  });

  it("still offers the editions of the area an ancestor is filed in", async () => {
    const grid = await getVariantPriceGrid(userId, {
      kind: "stamp",
      stampId: umbrellaId,
      subtree: true,
    });
    assert.deepEqual(
      grid.editions.map((e) => e.catalogNameId),
      [catalogNameId]
    );
    assert.equal(grid.defaultEditionId, grid.editions[0]?.editionId);
  });

  it("draws a leaf alone when the leaf itself is the subtree", async () => {
    const grid = await getVariantPriceGrid(userId, {
      kind: "stamp",
      stampId: variantAId,
      subtree: true,
    });
    assert.deepEqual(
      grid.rows.map((r) => r.stampId),
      [variantAId]
    );
  });
});
