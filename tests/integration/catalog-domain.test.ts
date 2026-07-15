import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getCatalogTree,
  createCatalogVendor,
  updateCatalogVendor,
  deleteCatalogVendor,
  createCatalogName,
  updateCatalogName,
  deleteCatalogName,
  createCatalogEdition,
  updateCatalogEdition,
  deleteCatalogEdition,
} from "../../src/lib/catalog";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-cat-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-cat-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-cat-${suffix}`, name: `Collection ${suffix}`, ownerId },
  });
}

describe("getCatalogTree", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`tree-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `tree-${ts}`)).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const cn = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Deutschland", currency: "EUR" },
    });
    await prisma.catalogEdition.createMany({
      data: [
        { catalogNameId: cn.id, year: 2022 },
        { catalogNameId: cn.id, year: 2023 },
      ],
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns nested vendor → name → editions structure", async () => {
    const tree = await getCatalogTree(userId, collectionId);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].name, "Michel");
    assert.equal(tree[0].abbreviation, "Mi");
    assert.equal(tree[0].catalogNames.length, 1);
    const cn = tree[0].catalogNames[0];
    assert.equal(cn.name, "Michel Deutschland");
    assert.equal(cn.currency, "EUR");
    assert.equal(cn.abbreviation, null);
    assert.equal(cn.catalogEditions.length, 2);
    assert.deepEqual(
      cn.catalogEditions.map((e) => e.year),
      [2022, 2023]
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => getCatalogTree("wrong-user", collectionId),
      /access denied/i
    );
  });
});

describe("createCatalogVendor", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cv-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cv-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a vendor scoped to the collection", async () => {
    await createCatalogVendor(userId, collectionId, { name: "Scott", abbreviation: "Sc" });
    const vendors = await prisma.catalogVendor.findMany({ where: { collectionId } });
    assert.equal(vendors.length, 1);
    assert.equal(vendors[0].name, "Scott");
    assert.equal(vendors[0].abbreviation, "Sc");
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createCatalogVendor("wrong-user", collectionId, { name: "X", abbreviation: "X" }),
      /access denied/i
    );
  });
});

describe("updateCatalogVendor", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`uv-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `uv-${ts}`)).id;
    const v = await prisma.catalogVendor.create({
      data: { collectionId, name: "Yvert", abbreviation: "Yv" },
    });
    vendorId = v.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("updates name and abbreviation", async () => {
    await updateCatalogVendor(userId, vendorId, { name: "Yvert & Tellier", abbreviation: "YT" });
    const v = await prisma.catalogVendor.findUniqueOrThrow({ where: { id: vendorId } });
    assert.equal(v.name, "Yvert & Tellier");
    assert.equal(v.abbreviation, "YT");
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => updateCatalogVendor("wrong-user", vendorId, { name: "X", abbreviation: "X" }),
      /access denied/i
    );
  });
});

describe("deleteCatalogVendor", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dv-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dv-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes vendor and cascades to names and editions", async () => {
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const cn = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Deutschland", currency: "EUR" },
    });
    await prisma.catalogEdition.create({ data: { catalogNameId: cn.id, year: 2024 } });

    await deleteCatalogVendor(userId, vendor.id);

    const vendors = await prisma.catalogVendor.findMany({ where: { collectionId } });
    assert.equal(vendors.length, 0);
    const names = await prisma.catalogName.findMany({ where: { vendorId: vendor.id } });
    assert.equal(names.length, 0);
    const editions = await prisma.catalogEdition.findMany({ where: { catalogNameId: cn.id } });
    assert.equal(editions.length, 0);
  });

  it("throws when collection is not owned by user", async () => {
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Scott", abbreviation: "Sc" },
    });
    await assert.rejects(
      () => deleteCatalogVendor("wrong-user", vendor.id),
      /access denied/i
    );
  });
});

describe("createCatalogName", () => {
  let userId: string;
  let vendorId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cn-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cn-${ts}`)).id;
    const v = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = v.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a catalog name with no abbreviation override", async () => {
    await createCatalogName(userId, vendorId, { name: "Michel Deutschland", currency: "EUR" });
    const names = await prisma.catalogName.findMany({ where: { vendorId } });
    assert.equal(names.length, 1);
    assert.equal(names[0].name, "Michel Deutschland");
    assert.equal(names[0].currency, "EUR");
    assert.equal(names[0].abbreviation, null);
  });

  it("creates a catalog name with abbreviation override", async () => {
    await createCatalogName(userId, vendorId, { name: "Michel Spezial", currency: "EUR", abbreviation: "MiSp" });
    const names = await prisma.catalogName.findMany({ where: { vendorId, name: "Michel Spezial" } });
    assert.equal(names.length, 1);
    assert.equal(names[0].abbreviation, "MiSp");
  });

  it("throws when vendor does not belong to user", async () => {
    await assert.rejects(
      () => createCatalogName("wrong-user", vendorId, { name: "X", currency: "USD" }),
      /access denied/i
    );
  });
});

describe("deleteCatalogName", () => {
  let userId: string;
  let vendorId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dn-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dn-${ts}`)).id;
    const v = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = v.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes catalog name and cascades to editions", async () => {
    const cn = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Deutschland", currency: "EUR" },
    });
    await prisma.catalogEdition.create({ data: { catalogNameId: cn.id, year: 2024 } });

    await deleteCatalogName(userId, cn.id);

    const found = await prisma.catalogName.findUnique({ where: { id: cn.id } });
    assert.equal(found, null);
    const editions = await prisma.catalogEdition.findMany({ where: { catalogNameId: cn.id } });
    assert.equal(editions.length, 0);
  });

  it("throws when name does not belong to user", async () => {
    const cn = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Spezial", currency: "EUR" },
    });
    await assert.rejects(
      () => deleteCatalogName("wrong-user", cn.id),
      /access denied/i
    );
  });
});

describe("updateCatalogName", () => {
  let userId: string;
  let vendorId: string;
  let nameId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`un-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `un-${ts}`)).id;
    const v = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = v.id;
    const cn = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Deutschland", currency: "EUR" },
    });
    nameId = cn.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("updates name, currency, and abbreviation", async () => {
    await updateCatalogName(userId, nameId, { name: "Michel BRD", currency: "DEM", abbreviation: "MiBRD" });
    const cn = await prisma.catalogName.findUniqueOrThrow({ where: { id: nameId } });
    assert.equal(cn.name, "Michel BRD");
    assert.equal(cn.currency, "DEM");
    assert.equal(cn.abbreviation, "MiBRD");
  });

  it("throws when name does not belong to user", async () => {
    await assert.rejects(
      () => updateCatalogName("wrong-user", nameId, { name: "X", currency: "USD" }),
      /access denied/i
    );
  });
});

describe("createCatalogEdition / updateCatalogEdition / deleteCatalogEdition", () => {
  let userId: string;
  let catalogNameId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`ed-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `ed-${ts}`)).id;
    const v = await prisma.catalogVendor.create({
      data: { collectionId, name: "Scott", abbreviation: "Sc" },
    });
    const cn = await prisma.catalogName.create({
      data: { vendorId: v.id, name: "Scott US", currency: "USD" },
    });
    catalogNameId = cn.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates an edition", async () => {
    await createCatalogEdition(userId, catalogNameId, { year: 2024 });
    const editions = await prisma.catalogEdition.findMany({ where: { catalogNameId } });
    assert.ok(editions.some((e) => e.year === 2024));
  });

  it("throws when name does not belong to user", async () => {
    await assert.rejects(
      () => createCatalogEdition("wrong-user", catalogNameId, { year: 2025 }),
      /access denied/i
    );
  });

  it("updates edition year", async () => {
    const ed = await prisma.catalogEdition.create({ data: { catalogNameId, year: 2020 } });
    await updateCatalogEdition(userId, ed.id, { year: 2021 });
    const updated = await prisma.catalogEdition.findUniqueOrThrow({ where: { id: ed.id } });
    assert.equal(updated.year, 2021);
  });

  it("deletes an edition", async () => {
    const ed = await prisma.catalogEdition.create({ data: { catalogNameId, year: 1999 } });
    await deleteCatalogEdition(userId, ed.id);
    const found = await prisma.catalogEdition.findUnique({ where: { id: ed.id } });
    assert.equal(found, null);
  });

  it("throws on delete when edition does not belong to user", async () => {
    const ed = await prisma.catalogEdition.create({ data: { catalogNameId, year: 1998 } });
    await assert.rejects(
      () => deleteCatalogEdition("wrong-user", ed.id),
      /access denied/i
    );
  });
});
