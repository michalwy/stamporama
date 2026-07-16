import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: {
      slug: `col-${suffix}`,
      name: `Collection ${suffix}`,
      ownerId,
    },
  });
}

describe("Stamp tree and catalog numbers", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  let cn1Id: string;
  let cn2Id: string;
  let baseStampId: string;
  let v1Id: string;
  let v2Id: string;

  before(async () => {
    const ts = Date.now();
    const u = await createTestUser(`stamp-tree-${ts}`);
    userId = u.id;
    const c = await createTestCollection(userId, `stamp-tree-${ts}`);
    collectionId = c.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = vendor.id;

    const cn1 = await prisma.catalogName.create({
      data: { vendorId, name: "Grundkatalog", currency: "EUR" },
    });
    cn1Id = cn1.id;

    const cn2 = await prisma.catalogName.create({
      data: { vendorId, name: "Spezialkatalog", currency: "EUR" },
    });
    cn2Id = cn2.id;

    const base = await prisma.stamp.create({ data: { collectionId, name: "Base stamp" } });
    baseStampId = base.id;

    const v1 = await prisma.stamp.create({ data: { collectionId, parentId: baseStampId, name: "Variant A" } });
    v1Id = v1.id;

    const v2 = await prisma.stamp.create({ data: { collectionId, parentId: baseStampId, name: "Variant B" } });
    v2Id = v2.id;

    await prisma.stampCatalogNumber.createMany({
      data: [
        { stampId: v1Id, catalogNameId: cn1Id, number: "1a" },
        { stampId: v1Id, catalogNameId: cn2Id, number: "1aS" },
        { stampId: v2Id, catalogNameId: cn1Id, number: "1b" },
        { stampId: v2Id, catalogNameId: cn2Id, number: "1bS" },
      ],
    });
  });

  after(async () => {
    await prisma.stampCatalogNumber.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.delete({ where: { id: vendorId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("base stamp has two variants", async () => {
    const variants = await prisma.stamp.findMany({ where: { parentId: baseStampId } });
    assert.equal(variants.length, 2);
  });

  it("variant has catalog numbers in both catalogs", async () => {
    const numbers = await prisma.stampCatalogNumber.findMany({ where: { stampId: v1Id } });
    assert.equal(numbers.length, 2);
  });

  it("lookup by composite key returns correct number", async () => {
    const num = await prisma.stampCatalogNumber.findUnique({
      where: { stampId_catalogNameId: { stampId: v1Id, catalogNameId: cn1Id } },
    });
    assert.ok(num);
    assert.equal(num.number, "1a");
  });

  it("variant lookup by catalogNameId", async () => {
    const num = await prisma.stampCatalogNumber.findUnique({
      where: { stampId_catalogNameId: { stampId: v2Id, catalogNameId: cn2Id } },
    });
    assert.ok(num);
    assert.equal(num.number, "1bS");
  });
});

describe("Series and SeriesMember", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  let catalogNameId: string;
  let s1Id: string;
  let s2Id: string;
  let s3Id: string;
  let v3Id: string;
  let seriesId: string;

  before(async () => {
    const ts = Date.now();
    const u = await createTestUser(`series-${ts}`);
    userId = u.id;
    const c = await createTestCollection(userId, `series-${ts}`);
    collectionId = c.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Scott", abbreviation: "Sc" },
    });
    vendorId = vendor.id;

    const cn = await prisma.catalogName.create({
      data: { vendorId, name: "Standard Postage Stamp Catalogue", currency: "USD" },
    });
    catalogNameId = cn.id;

    const s1 = await prisma.stamp.create({ data: { collectionId, name: "Stamp 1" } });
    s1Id = s1.id;
    const s2 = await prisma.stamp.create({ data: { collectionId, name: "Stamp 2" } });
    s2Id = s2.id;
    const s3 = await prisma.stamp.create({ data: { collectionId, name: "Stamp 3" } });
    s3Id = s3.id;
    const v3 = await prisma.stamp.create({ data: { collectionId, parentId: s3Id, name: "Stamp 3 Variant" } });
    v3Id = v3.id;

    const series = await prisma.series.create({
      data: { collectionId, catalogNameId, name: "Test Series", isAutoCreated: false },
    });
    seriesId = series.id;

    await prisma.seriesMember.createMany({
      data: [
        { seriesId, stampId: s1Id },
        { seriesId, stampId: s2Id },
        { seriesId, stampId: s3Id, requiredVariantId: v3Id },
      ],
    });
  });

  after(async () => {
    await prisma.seriesMember.deleteMany({ where: { seriesId } });
    await prisma.series.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.delete({ where: { id: vendorId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("series has three members", async () => {
    const members = await prisma.seriesMember.findMany({ where: { seriesId } });
    assert.equal(members.length, 3);
  });

  it("s3 member has requiredVariantId set", async () => {
    const member = await prisma.seriesMember.findUnique({
      where: { seriesId_stampId: { seriesId, stampId: s3Id } },
    });
    assert.ok(member);
    assert.equal(member.requiredVariantId, v3Id);
  });

  it("s1 member has no requiredVariantId", async () => {
    const member = await prisma.seriesMember.findUnique({
      where: { seriesId_stampId: { seriesId, stampId: s1Id } },
    });
    assert.ok(member);
    assert.equal(member.requiredVariantId, null);
  });

  it("isAutoCreated defaults to false", async () => {
    const series = await prisma.series.findUnique({ where: { id: seriesId } });
    assert.ok(series);
    assert.equal(series.isAutoCreated, false);
  });

  it("isAutoCreated roundtrip with true", async () => {
    const autoSeries = await prisma.series.create({
      data: { collectionId, catalogNameId, isAutoCreated: true },
    });
    const fetched = await prisma.series.findUnique({ where: { id: autoSeries.id } });
    assert.ok(fetched);
    assert.equal(fetched.isAutoCreated, true);
    await prisma.series.delete({ where: { id: autoSeries.id } });
  });
});
