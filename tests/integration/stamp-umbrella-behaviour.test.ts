import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";

// ADR-0010 §3: a base stamp is an unknown-variant umbrella IFF it has >=1 child whose
// effective actsAsVariant (override ?? subtype flag) is true. The lowest-child price is
// taken only over variant-kind descendants.

let userId: string;
let collectionId: string;
let conditionId: string;
let catalogEditionId: string;
let areaId: string;
let variantSubtypeId: string; // actsAsVariant = true
let distinctSubtypeId: string; // actsAsVariant = false

async function baseStampUmbrella(stampId: string): Promise<boolean> {
  const { items } = await listItemsPaginated(userId, collectionId, { stampId });
  return items[0].unknownVariant;
}

async function addAreaLink(stampId: string) {
  await prisma.stampCollectionArea.create({
    data: { stampId, collectionAreaId: areaId, isPrimary: true },
  });
}

async function addPrice(stampId: string, price: string) {
  await prisma.stampCatalogPrice.create({
    data: { stampId, catalogEditionId, conditionId, certificateStatusId: null, price, currency: "EUR" },
  });
}

/** A base stamp linked to the area, plus an owned copy on it. Returns the base id. */
async function baseWithCopy(name: string): Promise<string> {
  const base = await prisma.stamp.create({ data: { collectionId, name } });
  await addAreaLink(base.id);
  await createItem(userId, collectionId, { stampId: base.id, conditionId });
  return base.id;
}

async function addChild(
  parentId: string,
  name: string,
  subtypeId: string,
  actsAsVariantOverride: boolean | null = null
): Promise<string> {
  const child = await prisma.stamp.create({
    data: { collectionId, parentId, name, subtypeId, actsAsVariantOverride },
  });
  await addAreaLink(child.id);
  return child.id;
}

before(async () => {
  const ts = Date.now();
  userId = `test-user-umb-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User umb-${ts}`,
      email: `test-umb-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const col = await prisma.collection.create({
    data: { slug: `col-umb-${ts}`, name: `Collection umb-${ts}`, baseCurrency: "EUR", ownerId: userId },
  });
  collectionId = col.id;

  const vendor = await prisma.catalogVendor.create({
    data: { collectionId, name: "Michel", abbreviation: "Mi" },
  });
  const catalogName = await prisma.catalogName.create({
    data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
  });
  catalogEditionId = (
    await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
  ).id;
  conditionId = (
    await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    })
  ).id;
  areaId = (
    await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    })
  ).id;
  variantSubtypeId = (
    await prisma.stampSubtype.create({
      data: { collectionId, name: "Colour variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    })
  ).id;
  distinctSubtypeId = (
    await prisma.stampSubtype.create({
      data: { collectionId, name: "Error", actsAsVariant: false, isDefault: false, sortOrder: 1 },
    })
  ).id;
});

after(async () => {
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("unknown-variant umbrella keys off effective actsAsVariant", () => {
  it("no children → not an umbrella", async () => {
    const base = await baseWithCopy("solo");
    assert.equal(await baseStampUmbrella(base), false);
  });

  it("only distinct-entry children → NOT an umbrella", async () => {
    const base = await baseWithCopy("2 with errors");
    await addChild(base, "2 B1", distinctSubtypeId);
    await addChild(base, "2 B2", distinctSubtypeId);
    assert.equal(await baseStampUmbrella(base), false);
  });

  it("a variant child → umbrella", async () => {
    const base = await baseWithCopy("2 with variants");
    await addChild(base, "2a", variantSubtypeId);
    assert.equal(await baseStampUmbrella(base), true);
  });

  it("mixed children → umbrella (a variant child is present)", async () => {
    const base = await baseWithCopy("2 mixed");
    await addChild(base, "2a", variantSubtypeId);
    await addChild(base, "2 B1", distinctSubtypeId);
    assert.equal(await baseStampUmbrella(base), true);
  });

  it("override true on a distinct child → umbrella", async () => {
    const base = await baseWithCopy("2 forced variant");
    await addChild(base, "2 B1", distinctSubtypeId, true);
    assert.equal(await baseStampUmbrella(base), true);
  });

  it("override false on a variant child → NOT an umbrella", async () => {
    const base = await baseWithCopy("2 forced distinct");
    await addChild(base, "2a", variantSubtypeId, false);
    assert.equal(await baseStampUmbrella(base), false);
  });
});

describe("lowest-child valuation is over variant-kind children only", () => {
  it("ignores a cheaper distinct-entry child when valuing an unknown variant", async () => {
    const base = await baseWithCopy("2 valuation"); // base itself unpriced
    await addPrice(await addChild(base, "2a", variantSubtypeId), "10.00"); // variant
    await addPrice(await addChild(base, "2 B1", distinctSubtypeId), "1.00"); // distinct, cheaper

    const { items } = await listItemsPaginated(userId, collectionId, { stampId: base });
    const value = items[0].value;
    assert.equal(items[0].unknownVariant, true);
    assert.equal(value.uncertain, true);
    // Lowest among VARIANT children only → 10.00, not the distinct child's 1.00.
    assert.equal(value.amount, "10.00");
  });

  it("a base with only distinct children is valued by its own price, not uncertain", async () => {
    const base = await prisma.stamp.create({ data: { collectionId, name: "2 concrete" } });
    await addAreaLink(base.id);
    await addPrice(base.id, "5.00");
    await createItem(userId, collectionId, { stampId: base.id, conditionId });
    await addPrice(await addChild(base.id, "2 B1", distinctSubtypeId), "1.00");

    const { items } = await listItemsPaginated(userId, collectionId, { stampId: base.id });
    const value = items[0].value;
    assert.equal(items[0].unknownVariant, false);
    assert.equal(value.uncertain, false);
    assert.equal(value.amount, "5.00");
  });
});
