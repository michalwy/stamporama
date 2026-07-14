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
    data: { slug: `col-${suffix}`, name: `Collection ${suffix}`, ownerId },
  });
}

describe("CatalogVendor persistence", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cv-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cv-${ts}`)).id;
  });

  after(async () => {
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a catalog vendor with required fields", async () => {
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    assert.equal(vendor.name, "Michel");
    assert.equal(vendor.abbreviation, "Mi");
    assert.equal(vendor.collectionId, collectionId);
    assert.ok(typeof vendor.id === "string" && vendor.id.length > 0);
  });

  it("cascades delete when collection is deleted", async () => {
    const ts = Date.now();
    const u2 = await createTestUser(`cv-del-${ts}`);
    const c2 = await createTestCollection(u2.id, `cv-del-${ts}`);
    await prisma.catalogVendor.create({
      data: { collectionId: c2.id, name: "Scott", abbreviation: "Sc" },
    });

    await prisma.collection.delete({ where: { id: c2.id } });
    await prisma.user.delete({ where: { id: u2.id } });

    const remaining = await prisma.catalogVendor.findMany({ where: { collectionId: c2.id } });
    assert.equal(remaining.length, 0);
  });
});

describe("CatalogName persistence", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cn-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cn-${ts}`)).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = vendor.id;
  });

  after(async () => {
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a catalog name with currency and no abbreviation", async () => {
    const cn = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Deutschland", currency: "EUR" },
    });
    assert.equal(cn.name, "Michel Deutschland");
    assert.equal(cn.currency, "EUR");
    assert.equal(cn.abbreviation, null);
    assert.equal(cn.vendorId, vendorId);
  });

  it("stores an optional abbreviation override", async () => {
    const cn = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Spezial", currency: "EUR", abbreviation: "MiSp" },
    });
    assert.equal(cn.abbreviation, "MiSp");
  });

  it("cascades delete when vendor is deleted", async () => {
    const ts = Date.now();
    const u2 = await createTestUser(`cn-del-${ts}`);
    const c2 = await createTestCollection(u2.id, `cn-del-${ts}`);
    const v2 = await prisma.catalogVendor.create({
      data: { collectionId: c2.id, name: "Scott", abbreviation: "Sc" },
    });
    await prisma.catalogName.create({ data: { vendorId: v2.id, name: "Scott US", currency: "USD" } });

    await prisma.catalogVendor.delete({ where: { id: v2.id } });
    await prisma.collection.delete({ where: { id: c2.id } });
    await prisma.user.delete({ where: { id: u2.id } });

    const remaining = await prisma.catalogName.findMany({ where: { vendorId: v2.id } });
    assert.equal(remaining.length, 0);
  });
});

describe("CatalogEdition persistence", () => {
  let userId: string;
  let collectionId: string;
  let catalogNameId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`ce-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `ce-${ts}`)).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const cn = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Deutschland", currency: "EUR" },
    });
    catalogNameId = cn.id;
  });

  after(async () => {
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a catalog edition with a year", async () => {
    const ed = await prisma.catalogEdition.create({
      data: { catalogNameId, year: 2024 },
    });
    assert.equal(ed.year, 2024);
    assert.equal(ed.catalogNameId, catalogNameId);
    assert.ok(typeof ed.id === "string" && ed.id.length > 0);
  });

  it("allows multiple editions for the same catalog name", async () => {
    await prisma.catalogEdition.createMany({
      data: [
        { catalogNameId, year: 2022 },
        { catalogNameId, year: 2023 },
      ],
    });
    const editions = await prisma.catalogEdition.findMany({ where: { catalogNameId } });
    assert.ok(editions.length >= 3);
  });

  it("cascades delete when catalog name is deleted", async () => {
    const ts = Date.now();
    const u2 = await createTestUser(`ce-del-${ts}`);
    const c2 = await createTestCollection(u2.id, `ce-del-${ts}`);
    const v2 = await prisma.catalogVendor.create({
      data: { collectionId: c2.id, name: "Yvert", abbreviation: "Yv" },
    });
    const cn2 = await prisma.catalogName.create({
      data: { vendorId: v2.id, name: "Yvert France", currency: "EUR" },
    });
    await prisma.catalogEdition.create({ data: { catalogNameId: cn2.id, year: 2020 } });

    await prisma.catalogName.delete({ where: { id: cn2.id } });
    await prisma.catalogVendor.delete({ where: { id: v2.id } });
    await prisma.collection.delete({ where: { id: c2.id } });
    await prisma.user.delete({ where: { id: u2.id } });

    const remaining = await prisma.catalogEdition.findMany({ where: { catalogNameId: cn2.id } });
    assert.equal(remaining.length, 0);
  });
});
