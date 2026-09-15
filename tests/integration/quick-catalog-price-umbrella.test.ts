import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getQuickCatalogPriceContext } from "../../src/lib/stamps";

// Scan-tile identification offers an umbrella's variant grid in place of the one catalogue-value
// field (#1317), and it learns which stamp is an umbrella from the read that field already makes.
// The rule has to be the grid's own (#627): a child counts only when it acts as a variant, so a
// stamp whose children are all something else keeps the field.

describe("quick catalog price context says whether the stamp is an umbrella (#1317)", () => {
  let userId: string;
  let conditionId: string;
  let umbrellaId: string;
  let variantId: string;
  let plainParentId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-qcu-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User qcu-${ts}`,
        email: `test-qcu-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const collectionId = (
      await prisma.collection.create({
        data: { slug: `col-qcu-${ts}`, name: `Collection qcu-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } });
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });

    const inArea = async (data: {
      name: string;
      parentId?: string;
      actsAsVariantOverride?: boolean;
    }) => {
      const stamp = await prisma.stamp.create({ data: { collectionId, ...data } });
      await prisma.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
      });
      return stamp.id;
    };

    umbrellaId = await inArea({ name: "309" });
    variantId = await inArea({ name: "309A", parentId: umbrellaId, actsAsVariantOverride: true });
    plainParentId = await inArea({ name: "310" });
    await inArea({ name: "310 overprint", parentId: plainParentId, actsAsVariantOverride: false });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("is true for a stamp with a variant child", async () => {
    const context = await getQuickCatalogPriceContext(userId, umbrellaId, conditionId, null);
    assert.equal(context.isUmbrella, true);
  });

  it("is false for the variant itself, which has none of its own", async () => {
    const context = await getQuickCatalogPriceContext(userId, variantId, conditionId, null);
    assert.equal(context.isUmbrella, false);
  });

  it("is false for a stamp whose children do not act as variants", async () => {
    const context = await getQuickCatalogPriceContext(userId, plainParentId, conditionId, null);
    assert.equal(context.isUmbrella, false);
  });
});
