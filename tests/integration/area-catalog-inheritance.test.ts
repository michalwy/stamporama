import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { buildEffectiveAreaCatalogMap, buildVendorCatalogMap } from "../../src/lib/pricing";
import { getVariantPriceGrid } from "../../src/lib/variant-prices";
import { getQuickCatalogPriceContext } from "../../src/lib/stamps";

// **Price-source books inherit down the area tree** (#675).
//
// Three server paths resolve which catalogues price an area, and until #675 only one of them walked
// the tree: the trade's agreed catalog (#638) inherited, while the variant price grid and the stamp
// catalog-prices tab read the area's own `CollectionAreaCatalog` rows and nothing else. So a leaf
// area — the level material is actually filed at — offered no editions at all unless the same books
// were re-attached to it, which is the slowest part of setting a new area up.
//
// One resolution now serves all three: `buildEffectiveAreaCatalogMap`, nearest ancestor that
// attaches any. The unit that inherits is the whole list, so an area that attaches books of its own
// states its price sources completely rather than merging with an ancestor's.

describe("effective area catalogs inherit down the tree (#675)", () => {
  let userId: string;
  let collectionId: string;
  let michelId: string;
  let michelBookId: string;
  let michelSpezialId: string;
  let fischerBookId: string;
  let parentAreaId: string;
  let leafAreaId: string;
  let ownBooksAreaId: string;
  let leafStampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-eac-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User eac-${ts}`,
        email: `test-eac-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-eac-${ts}`,
          name: `Collection eac-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;

    const michel = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    michelId = michel.id;
    const fischer = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });

    michelBookId = (
      await prisma.catalogName.create({
        data: { vendorId: michelId, name: "Michel Deutschland", currency: "EUR" },
      })
    ).id;
    michelSpezialId = (
      await prisma.catalogName.create({
        data: { vendorId: michelId, name: "Michel Deutschland Spezial", currency: "EUR" },
      })
    ).id;
    fischerBookId = (
      await prisma.catalogName.create({
        data: { vendorId: fischer.id, name: "Fischer", currency: "PLN" },
      })
    ).id;
    for (const catalogNameId of [michelBookId, michelSpezialId, fischerBookId]) {
      await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } });
    }

    // Germany declares the books; its child declares none, which is the ordinary shape.
    parentAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Germany", primaryCatalogNameId: michelBookId },
      })
    ).id;
    await prisma.collectionAreaCatalog.createMany({
      data: [michelBookId, michelSpezialId, fischerBookId].map((catalogNameId) => ({
        collectionAreaId: parentAreaId,
        catalogNameId,
      })),
    });
    leafAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Third Reich 1933–1945", parentId: parentAreaId },
      })
    ).id;
    // A sibling that does declare its own — one book, and it means *only* that book.
    ownBooksAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Weimar Republic", parentId: parentAreaId },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: ownBooksAreaId, catalogNameId: michelSpezialId },
    });

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    leafStampId = (await prisma.stamp.create({ data: { collectionId, name: "Leaf stamp" } })).id;
    await prisma.stampCollectionArea.create({
      data: { stampId: leafStampId, collectionAreaId: leafAreaId, isPrimary: true },
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("gives a leaf that attaches nothing its nearest ancestor's whole book list", async () => {
    const byArea = await buildEffectiveAreaCatalogMap(collectionId);
    assert.deepEqual(
      [...(byArea.get(leafAreaId) ?? [])].sort(),
      [michelBookId, michelSpezialId, fischerBookId].sort()
    );
  });

  it("lets an area that attaches its own books state them completely", async () => {
    const byArea = await buildEffectiveAreaCatalogMap(collectionId);
    assert.deepEqual(byArea.get(ownBooksAreaId), [michelSpezialId]);
  });

  it("resolves a named vendor's book off the same list", async () => {
    const byArea = await buildVendorCatalogMap(collectionId, michelId);
    // Two Michel books on Germany: the first by name, deterministically, on the leaf as well.
    assert.equal(byArea.get(parentAreaId), michelBookId);
    assert.equal(byArea.get(leafAreaId), michelBookId);
    // The sibling declared only the Spezial, so that is the volume its lines are read in.
    assert.equal(byArea.get(ownBooksAreaId), michelSpezialId);
  });

  it("offers the leaf the same variant-grid editions as the area that declares the books", async () => {
    const grid = await getVariantPriceGrid(userId, { kind: "stamp", stampId: leafStampId });
    assert.deepEqual(
      grid.editions.map((e) => e.catalogNameId).sort(),
      [michelBookId, michelSpezialId, fischerBookId].sort()
    );
    // The inherited primary still leads the list.
    assert.equal(grid.editions[0]?.catalogNameId, michelBookId);
    assert.equal(grid.editions[0]?.isPrimary, true);
  });

  it("offers the leaf the same catalog-prices targets as that area", async () => {
    const context = await getQuickCatalogPriceContext(
      userId,
      leafStampId,
      conditionId,
      null,
      null
    );
    assert.deepEqual(
      context.catalogs.map((c) => c.catalogNameId).sort(),
      [michelBookId, michelSpezialId, fischerBookId].sort()
    );
    assert.equal(context.catalogs.find((c) => c.isPrimary)?.catalogNameId, michelBookId);
  });
});
