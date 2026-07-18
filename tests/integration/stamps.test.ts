import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createStamp,
  createVariant,
  updateStamp,
  deleteStamp,
  getStamp,
  listStamps,
  listStampsPaginated,
  getStampChildCount,
  upsertStampCatalogNumber,
  deleteStampCatalogNumber,
  updateStampWithCatalog,
  getStampCatalogPrices,
  findStaleCatalogPrices,
} from "../../src/lib/stamps";
import { deleteStampCondition, ConditionInUseError } from "../../src/lib/conditions";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-stamps-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-stamps-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-stamps-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("createStamp", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cs-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cs-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a base stamp with correct collectionId", async () => {
    const stamp = await createStamp(userId, collectionId, { name: "My Stamp", issuedYear: 1960 });
    assert.equal(stamp.collectionId, collectionId);
    assert.equal(stamp.parentId, null);
    assert.equal(stamp.name, "My Stamp");
    assert.equal(stamp.issuedYear, 1960);
    const persisted = await prisma.stamp.findUnique({ where: { id: stamp.id } });
    assert.ok(persisted);
  });

  it("creates a base stamp without optional fields", async () => {
    const stamp = await createStamp(userId, collectionId, {});
    assert.equal(stamp.collectionId, collectionId);
    assert.equal(stamp.name, null);
    assert.equal(stamp.issuedYear, null);
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createStamp("wrong-user", collectionId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("createVariant", () => {
  let userId: string;
  let collectionId: string;
  let baseStampId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cv-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cv-${ts}`)).id;
    const base = await prisma.stamp.create({ data: { collectionId, name: "Base" } });
    baseStampId = base.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a variant linked to parent, sharing collectionId", async () => {
    const variant = await createVariant(userId, baseStampId, { name: "Variant A" });
    assert.equal(variant.parentId, baseStampId);
    assert.equal(variant.collectionId, collectionId);
    assert.equal(variant.name, "Variant A");
  });

  it("throws when caller does not own the parent's collection", async () => {
    await assert.rejects(
      () => createVariant("wrong-user", baseStampId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("updateStamp", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`us-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `us-${ts}`)).id;
    const stamp = await prisma.stamp.create({
      data: { collectionId, name: "Old Name", issuedYear: 1950 },
    });
    stampId = stamp.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("updates name and issuedYear", async () => {
    await updateStamp(userId, stampId, { name: "New Name", issuedYear: 1975 });
    const updated = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(updated.name, "New Name");
    assert.equal(updated.issuedYear, 1975);
  });

  it("clears fields when null is passed", async () => {
    await updateStamp(userId, stampId, { name: null, issuedYear: null });
    const updated = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(updated.name, null);
    assert.equal(updated.issuedYear, null);
  });

  it("throws when caller does not own the stamp's collection", async () => {
    await assert.rejects(
      () => updateStamp("wrong-user", stampId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("deleteStamp", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`ds-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `ds-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes a base stamp; variants are cascade-removed", async () => {
    const base = await prisma.stamp.create({ data: { collectionId, name: "Base" } });
    const variant = await prisma.stamp.create({
      data: { collectionId, parentId: base.id, name: "Variant" },
    });

    await deleteStamp(userId, base.id);

    const foundBase = await prisma.stamp.findUnique({ where: { id: base.id } });
    assert.equal(foundBase, null);
    const foundVariant = await prisma.stamp.findUnique({ where: { id: variant.id } });
    assert.equal(foundVariant, null);
  });

  it("throws when caller does not own the stamp's collection", async () => {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Protected" } });
    await assert.rejects(
      () => deleteStamp("wrong-user", stamp.id),
      /access denied/i
    );
  });
});

describe("getStamp", () => {
  let userId: string;
  let collectionId: string;
  let baseStampId: string;
  let variantId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`gs-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `gs-${ts}`)).id;
    const base = await prisma.stamp.create({ data: { collectionId, name: "Base" } });
    baseStampId = base.id;
    const v = await prisma.stamp.create({
      data: { collectionId, parentId: baseStampId, name: "Variant" },
    });
    variantId = v.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns stamp with its variant children", async () => {
    const stamp = await getStamp(userId, baseStampId);
    assert.equal(stamp.id, baseStampId);
    assert.equal(stamp.variants.length, 1);
    assert.equal(stamp.variants[0].id, variantId);
  });

  it("throws when caller does not own the stamp's collection", async () => {
    await assert.rejects(
      () => getStamp("wrong-user", baseStampId),
      /access denied/i
    );
  });
});

describe("listStamps", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let areaId: string;
  let stampInAreaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`ls-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `ls-${ts}`)).id;
    otherCollectionId = (await createTestCollection(userId, `ls-other-${ts}`)).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany" },
    });
    areaId = area.id;

    const stampInArea = await prisma.stamp.create({ data: { collectionId, name: "In Area" } });
    stampInAreaId = stampInArea.id;
    await prisma.stampCollectionArea.create({
      data: { stampId: stampInAreaId, collectionAreaId: areaId },
    });

    await prisma.stamp.create({ data: { collectionId, name: "No Area" } });

    // variant — should NOT appear in list results
    await prisma.stamp.create({
      data: { collectionId, parentId: stampInAreaId, name: "Variant" },
    });

    // stamp in a different collection
    await prisma.stamp.create({ data: { collectionId: otherCollectionId, name: "Other" } });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns only base stamps for the collection", async () => {
    const stamps = await listStamps(userId, collectionId);
    assert.ok(stamps.length >= 2);
    assert.ok(stamps.every((s) => s.collectionId === collectionId));
    assert.ok(stamps.every((s) => s.parentId === null));
  });

  it("does not return stamps from another collection", async () => {
    const stamps = await listStamps(userId, collectionId);
    assert.ok(stamps.every((s) => s.collectionId !== otherCollectionId));
  });

  it("filters by collectionAreaId when provided", async () => {
    const stamps = await listStamps(userId, collectionId, { collectionAreaId: areaId });
    assert.equal(stamps.length, 1);
    assert.equal(stamps[0].id, stampInAreaId);
  });

  it("throws when caller does not own the collection", async () => {
    await assert.rejects(
      () => listStamps("wrong-user", collectionId),
      /access denied/i
    );
  });
});

describe("upsertStampCatalogNumber / deleteStampCatalogNumber", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let vendorId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`scn-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `scn-${ts}`)).id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test" } });
    stampId = stamp.id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = vendor.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("upsert creates a catalog number entry", async () => {
    await upsertStampCatalogNumber(userId, stampId, vendorId, "1a");
    const entry = await prisma.stampCatalogNumber.findUnique({
      where: { stampId_catalogVendorId: { stampId, catalogVendorId: vendorId } },
    });
    assert.ok(entry);
    assert.equal(entry.number, "1a");
  });

  it("second upsert updates the number in place", async () => {
    await upsertStampCatalogNumber(userId, stampId, vendorId, "1b");
    const entry = await prisma.stampCatalogNumber.findUnique({
      where: { stampId_catalogVendorId: { stampId, catalogVendorId: vendorId } },
    });
    assert.ok(entry);
    assert.equal(entry.number, "1b");
    const all = await prisma.stampCatalogNumber.findMany({ where: { stampId, catalogVendorId: vendorId } });
    assert.equal(all.length, 1);
  });

  it("upsert throws when caller does not own the stamp's collection", async () => {
    await assert.rejects(
      () => upsertStampCatalogNumber("wrong-user", stampId, vendorId, "2a"),
      /access denied/i
    );
  });

  it("delete removes the catalog number entry", async () => {
    await deleteStampCatalogNumber(userId, stampId, vendorId);
    const entry = await prisma.stampCatalogNumber.findUnique({
      where: { stampId_catalogVendorId: { stampId, catalogVendorId: vendorId } },
    });
    assert.equal(entry, null);
  });

  it("delete throws when caller does not own the stamp's collection", async () => {
    // re-create an entry first
    await prisma.stampCatalogNumber.create({ data: { stampId, catalogVendorId: vendorId, number: "99" } });
    await assert.rejects(
      () => deleteStampCatalogNumber("wrong-user", stampId, vendorId),
      /access denied/i
    );
  });
});

describe("catalog prices per condition & certificate status", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let editionId2023: string;
  let editionId2024: string;
  let conditionId: string;
  let certStatusId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-stamps-scp-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User scp-${ts}`,
        email: `test-stamps-scp-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-stamps-scp-${ts}`, name: `Collection scp-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Catalog Price Test" } });
    stampId = stamp.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const ed2023 = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2023 },
    });
    editionId2023 = ed2023.id;
    const ed2024 = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2024 },
    });
    editionId2024 = ed2024.id;

    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });
    conditionId = condition.id;
    const cert = await prisma.certificateStatus.create({
      data: { collectionId, name: "Certificate", abbreviation: "Cert", sortOrder: 0 },
    });
    certStatusId = cert.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function setPrices(
    prices: { catalogEditionId: string; conditionId: string; certificateStatusId: string | null; price: string; currency: string }[]
  ) {
    await updateStampWithCatalog(userId, stampId, { catalogNumbers: [], catalogPrices: prices });
  }

  it("records a price for a (condition, no certificate) pair", async () => {
    await setPrices([
      { catalogEditionId: editionId2023, conditionId, certificateStatusId: null, price: "12.50", currency: "EUR" },
    ]);
    const rows = await getStampCatalogPrices(userId, stampId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].conditionId, conditionId);
    assert.equal(rows[0].certificateStatusId, null);
    assert.equal(Number(rows[0].price), 12.5);
  });

  it("stores multiple prices per edition across condition/certificate pairs", async () => {
    await setPrices([
      { catalogEditionId: editionId2023, conditionId, certificateStatusId: null, price: "50.00", currency: "EUR" },
      { catalogEditionId: editionId2023, conditionId, certificateStatusId: certStatusId, price: "120.00", currency: "EUR" },
    ]);
    const rows = await prisma.stampCatalogPrice.findMany({
      where: { stampId, catalogEditionId: editionId2023 },
    });
    assert.equal(rows.length, 2);
    const withCert = rows.find((r) => r.certificateStatusId === certStatusId);
    const noCert = rows.find((r) => r.certificateStatusId === null);
    assert.equal(Number(withCert?.price), 120);
    assert.equal(Number(noCert?.price), 50);
  });

  it("unique index treats NULL certificate as a single value (no duplicate no-cert rows)", async () => {
    await assert.rejects(() =>
      prisma.stampCatalogPrice.create({
        data: { stampId, catalogEditionId: editionId2023, conditionId, certificateStatusId: null, price: "9.99", currency: "EUR" },
      })
    );
  });

  it("blocks deleting a condition that is referenced by a price", async () => {
    await assert.rejects(
      () => deleteStampCondition(userId, conditionId),
      (err) => err instanceof ConditionInUseError
    );
  });

  it("findStaleCatalogPrices flags a price on a non-latest edition", async () => {
    // Reset to a single 2023 price; 2024 edition exists → stale.
    await setPrices([
      { catalogEditionId: editionId2023, conditionId, certificateStatusId: null, price: "15.00", currency: "EUR" },
    ]);
    const stale = await findStaleCatalogPrices(userId, collectionId);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].catalogEditionId, editionId2023);
    assert.equal(stale[0].latestEditionId, editionId2024);
  });

  it("findStaleCatalogPrices is empty when the price is on the latest edition", async () => {
    await setPrices([
      { catalogEditionId: editionId2024, conditionId, certificateStatusId: null, price: "20.00", currency: "EUR" },
    ]);
    const stale = await findStaleCatalogPrices(userId, collectionId);
    assert.equal(stale.length, 0);
  });

  it("findStaleCatalogPrices throws when caller does not own the collection", async () => {
    await assert.rejects(
      () => findStaleCatalogPrices("wrong-user", collectionId),
      /access denied/i
    );
  });
});

describe("listStamps mainCatalogPriceStale", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let editionId2023: string;
  let editionId2024: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`lsstale-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `lsstale-${ts}`)).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    editionId2023 = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2023 } })
    ).id;
    editionId2024 = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    // Area whose primary catalog is this catalog name, so the price surfaces in the list.
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Staleness Test" } });
    stampId = stamp.id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("flags the displayed price as stale when only a non-latest edition is priced", async () => {
    await updateStampWithCatalog(userId, stampId, {
      catalogNumbers: [],
      catalogPrices: [
        { catalogEditionId: editionId2023, conditionId, certificateStatusId: null, price: "12.50", currency: "EUR" },
      ],
    });
    const { items } = await listStampsPaginated(userId, collectionId, {});
    const item = items.find((s) => s.id === stampId);
    assert.ok(item);
    assert.equal(item.mainCatalogPrice?.amount, "12.50");
    assert.equal(item.mainCatalogPriceStale, true);
  });

  it("clears the flag once the latest edition is priced", async () => {
    await updateStampWithCatalog(userId, stampId, {
      catalogNumbers: [],
      catalogPrices: [
        { catalogEditionId: editionId2023, conditionId, certificateStatusId: null, price: "12.50", currency: "EUR" },
        { catalogEditionId: editionId2024, conditionId, certificateStatusId: null, price: "20.00", currency: "EUR" },
      ],
    });
    const { items } = await listStampsPaginated(userId, collectionId, {});
    const item = items.find((s) => s.id === stampId);
    assert.ok(item);
    // main price is now the 2024 (latest) edition
    assert.equal(item.mainCatalogPrice?.amount, "20.00");
    assert.equal(item.mainCatalogPriceStale, false);
  });
});

describe("deleteStamp reparent mode", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dsr-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dsr-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("reparents children to grandparent when deleting a mid-level node", async () => {
    const grandparent = await prisma.stamp.create({ data: { collectionId, name: "Grandparent" } });
    const parent = await prisma.stamp.create({ data: { collectionId, parentId: grandparent.id, name: "Parent" } });
    const child1 = await prisma.stamp.create({ data: { collectionId, parentId: parent.id, name: "Child 1" } });
    const child2 = await prisma.stamp.create({ data: { collectionId, parentId: parent.id, name: "Child 2" } });

    await deleteStamp(userId, parent.id, "reparent");

    assert.equal(await prisma.stamp.findUnique({ where: { id: parent.id } }), null);
    const c1 = await prisma.stamp.findUniqueOrThrow({ where: { id: child1.id } });
    const c2 = await prisma.stamp.findUniqueOrThrow({ where: { id: child2.id } });
    assert.equal(c1.parentId, grandparent.id);
    assert.equal(c2.parentId, grandparent.id);
  });

  it("reparents children to root when deleting a root node", async () => {
    const root = await prisma.stamp.create({ data: { collectionId, name: "Root" } });
    const child = await prisma.stamp.create({ data: { collectionId, parentId: root.id, name: "Child" } });

    await deleteStamp(userId, root.id, "reparent");

    assert.equal(await prisma.stamp.findUnique({ where: { id: root.id } }), null);
    const c = await prisma.stamp.findUniqueOrThrow({ where: { id: child.id } });
    assert.equal(c.parentId, null);
  });

  it("works the same as cascade for a leaf node", async () => {
    const leaf = await prisma.stamp.create({ data: { collectionId, name: "Leaf" } });

    await deleteStamp(userId, leaf.id, "reparent");

    assert.equal(await prisma.stamp.findUnique({ where: { id: leaf.id } }), null);
  });
});

describe("getStampChildCount", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`gcc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `gcc-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns 0 for a leaf stamp", async () => {
    const leaf = await prisma.stamp.create({ data: { collectionId, name: "Leaf" } });
    assert.equal(await getStampChildCount(userId, leaf.id), 0);
  });

  it("returns the number of direct children", async () => {
    const parent = await prisma.stamp.create({ data: { collectionId, name: "Parent" } });
    await prisma.stamp.create({ data: { collectionId, parentId: parent.id, name: "C1" } });
    await prisma.stamp.create({ data: { collectionId, parentId: parent.id, name: "C2" } });
    assert.equal(await getStampChildCount(userId, parent.id), 2);
  });
});
