import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getQuickCatalogPriceContext, quickSetCatalogPrices } from "../../src/lib/stamps";
import {
  getVariantPriceGrid,
  listUnpricedVariantTrees,
  setVariantCatalogPrice,
} from "../../src/lib/variant-prices";

// A catalogue price cell can say the catalogue gives no price on purpose (#1615): *does not exist*
// where it prints —, *not determinable* where it prints ?. Pinned here against the database: a row
// holds a price or a mark and never both or neither, a mark and a figure replace each other as one
// edit, clearing goes back to *not entered yet*, and the variant worklist stops asking for a cell
// that has nothing to enter.

describe("a catalogue price can be marked as not applicable (#1615)", () => {
  const ts = Date.now();
  let userId: string;
  let collectionId: string;
  let catalogNameId: string;
  let editionId: string;
  let mnhId: string;
  let umbrellaId: string;
  const variantIds: string[] = [];

  before(async () => {
    userId = `test-user-cpm-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User cpm-${ts}`,
        email: `test-cpm-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-cpm-${ts}`, name: "Marks", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    catalogNameId = (
      await prisma.catalogName.create({ data: { vendorId: vendor.id, name: "Michel", currency: "EUR" } })
    ).id;
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogNameId },
    });
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: area.id, catalogNameId } });
    const color = await prisma.stampSubtype.create({
      data: { collectionId, name: "Color", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });
    umbrellaId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Umbrella",
          stampAreaLinks: { create: [{ collectionAreaId: area.id, isPrimary: true }] },
        },
      })
    ).id;
    for (const name of ["Variant a", "Variant b"]) {
      const v = await prisma.stamp.create({
        data: {
          collectionId,
          name,
          parentId: umbrellaId,
          subtypeId: color.id,
          stampAreaLinks: { create: [{ collectionAreaId: area.id, isPrimary: true }] },
        },
      });
      variantIds.push(v.id);
    }
    // The worklist asks only about conditions the collection holds: one copy at MNH.
    await prisma.item.create({
      data: {
        collectionId,
        itemNo: 1,
        stampId: variantIds[0],
        conditionId: mnhId,
        deliveryState: "delivered",
        inCollection: true,
      },
    });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const cell = (stampId: string, amount: Parameters<typeof setVariantCatalogPrice>[1]["amount"]) =>
    setVariantCatalogPrice(userId, {
      stampId,
      catalogEditionId: editionId,
      conditionId: mnhId,
      certificateStatusId: null,
      formatId: null,
      amount,
    });
  const rowOf = (stampId: string) =>
    prisma.stampCatalogPrice.findFirst({
      where: { stampId, catalogEditionId: editionId, conditionId: mnhId },
      select: { price: true, mark: true, currency: true },
    });

  it("refuses a row that holds both a price and a mark, or neither, or a mark it does not know", async () => {
    const base = {
      stampId: variantIds[1],
      catalogEditionId: editionId,
      conditionId: mnhId,
      currency: "EUR",
    };
    await assert.rejects(prisma.stampCatalogPrice.create({ data: { ...base, price: "1.00", mark: "nonexistent" } }));
    await assert.rejects(prisma.stampCatalogPrice.create({ data: { ...base, price: null, mark: null } }));
    await assert.rejects(prisma.stampCatalogPrice.create({ data: { ...base, price: null, mark: "sold out" } }));
  });

  it("writes a mark through the grid, replaces it with a figure and back, and clears it", async () => {
    await cell(variantIds[0], "nonexistent");
    assert.deepEqual(await rowOf(variantIds[0]), { price: null, mark: "nonexistent", currency: "EUR" });

    await cell(variantIds[0], 12.5);
    const priced = await rowOf(variantIds[0]);
    assert.equal(priced?.price?.toFixed(2), "12.50");
    assert.equal(priced?.mark, null);

    await cell(variantIds[0], "undeterminable");
    assert.deepEqual(await rowOf(variantIds[0]), { price: null, mark: "undeterminable", currency: "EUR" });

    const grid = await getVariantPriceGrid(userId, { kind: "stamp", stampId: umbrellaId });
    const record = grid.prices.find((p) => p.stampId === variantIds[0]);
    assert.equal(record?.mark, "undeterminable");
    assert.equal(record?.amount, "");

    await cell(variantIds[0], null);
    assert.equal(await rowOf(variantIds[0]), null);
  });

  it("stops the worklist asking for a tree once its empty cells are all marked", async () => {
    const before = await listUnpricedVariantTrees(userId, collectionId);
    assert.deepEqual(before.trees.map((t) => [t.stampId, t.gapCount]), [[umbrellaId, 2]]);

    await cell(variantIds[0], "nonexistent");
    const one = await listUnpricedVariantTrees(userId, collectionId);
    assert.deepEqual(one.trees.map((t) => [t.stampId, t.gapCount]), [[umbrellaId, 1]]);

    await cell(variantIds[1], "undeterminable");
    assert.deepEqual((await listUnpricedVariantTrees(userId, collectionId)).trees, []);

    await cell(variantIds[0], null);
    await cell(variantIds[1], null);
  });

  it("records a mark from the quick editor, and reads it back as its sign", async () => {
    await quickSetCatalogPrices(userId, variantIds[1], mnhId, null, [{ catalogNameId, amount: "nonexistent" }]);
    assert.deepEqual(await rowOf(variantIds[1]), { price: null, mark: "nonexistent", currency: "EUR" });

    const context = await getQuickCatalogPriceContext(userId, variantIds[1], mnhId, null);
    assert.equal(context.catalogs[0]?.amount, "—");
    assert.deepEqual(
      context.otherPrices.map((p) => [p.price, p.mark]),
      [["—", "nonexistent"]]
    );

    await quickSetCatalogPrices(userId, variantIds[1], mnhId, null, [{ catalogNameId, amount: 4 }]);
    const priced = await rowOf(variantIds[1]);
    assert.equal(priced?.price?.toFixed(2), "4.00");
    assert.equal(priced?.mark, null);
  });
});
