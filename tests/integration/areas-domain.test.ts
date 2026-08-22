import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getCollectionAreas,
  createCollectionArea,
  updateCollectionArea,
  deleteCollectionArea,
  syncAreaCatalogBooks,
  syncAreaVendors,
} from "../../src/lib/areas";
import { getCollectionTitleLanguages } from "../../src/lib/contacts";
import { setCollectionDefaultLanguage } from "../../src/lib/collections";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-areas-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-areas-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-areas-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("getCollectionAreas", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`gca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `gca-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns empty array for a new collection", async () => {
    const areas = await getCollectionAreas(userId, collectionId);
    assert.equal(areas.length, 0);
  });

  it("returns all areas for the collection", async () => {
    const ts = Date.now();
    await prisma.collectionArea.createMany({
      data: [
        { collectionId, name: `Europe-${ts}` },
        { collectionId, name: `Asia-${ts}` },
      ],
    });
    const areas = await getCollectionAreas(userId, collectionId);
    assert.ok(areas.length >= 2);
    assert.ok(areas.every((a) => a.id && a.name));
  });

  it("returns correct childCount", async () => {
    const ts = Date.now();
    const parent = await prisma.collectionArea.create({
      data: { collectionId, name: `Parent-${ts}` },
    });
    await prisma.collectionArea.create({
      data: { collectionId, name: `Child-${ts}`, parentId: parent.id },
    });
    const areas = await getCollectionAreas(userId, collectionId);
    const parentData = areas.find((a) => a.id === parent.id);
    assert.ok(parentData);
    assert.equal(parentData.childCount, 1);
  });

  it("returns correct stampCount", async () => {
    const ts = Date.now();
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: `Stamped-${ts}` },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test" } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id },
    });
    const areas = await getCollectionAreas(userId, collectionId);
    const areaData = areas.find((a) => a.id === area.id);
    assert.ok(areaData);
    assert.equal(areaData.stampCount, 1);
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => getCollectionAreas("wrong-user", collectionId),
      /access denied/i
    );
  });
});

describe("createCollectionArea", () => {
  let userId: string;
  let collectionId: string;
  let catalogNameId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cca-${ts}`)).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const cn = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Deutschland", currency: "EUR" },
    });
    catalogNameId = cn.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a top-level area with primary catalog", async () => {
    await createCollectionArea(userId, collectionId, {
      name: "Europe",
      primaryCatalogNameId: catalogNameId,
    });
    const found = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "Europe" },
    });
    assert.ok(found);
    assert.equal(found.parentId, null);
    assert.equal(found.description, null);
    assert.equal(found.primaryCatalogNameId, catalogNameId);
  });

  it("creates an area with all optional fields", async () => {
    await createCollectionArea(userId, collectionId, {
      name: "Germany",
      description: "German stamps",
      primaryCatalogNameId: catalogNameId,
    });
    const found = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "Germany" },
    });
    assert.ok(found);
    assert.equal(found.description, "German stamps");
    assert.equal(found.primaryCatalogNameId, catalogNameId);
  });

  it("creates a child area inheriting primary catalog from parent", async () => {
    const parent = await prisma.collectionArea.create({
      data: { collectionId, name: "ParentArea", primaryCatalogNameId: catalogNameId },
    });
    await createCollectionArea(userId, collectionId, {
      name: "ChildArea",
      parentId: parent.id,
    });
    const found = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "ChildArea" },
    });
    assert.ok(found);
    assert.equal(found.parentId, parent.id);
    assert.equal(found.primaryCatalogNameId, null);
  });

  it("throws when no effective primary catalog exists", async () => {
    await assert.rejects(
      () => createCollectionArea(userId, collectionId, { name: "NoCatalog" }),
      /primary catalog is required/i
    );
  });

  it("throws when parentId references area in a different collection", async () => {
    const otherUser = await createTestUser(`cca-other-${Date.now()}`);
    const otherCollection = await createTestCollection(otherUser.id, `cca-other-${Date.now()}`);
    const otherArea = await prisma.collectionArea.create({
      data: { collectionId: otherCollection.id, name: "Other" },
    });
    await assert.rejects(
      () => createCollectionArea(userId, collectionId, { name: "Bad", parentId: otherArea.id }),
      /parent area not found/i
    );
    await prisma.collection.deleteMany({ where: { ownerId: otherUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createCollectionArea("wrong-user", collectionId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("updateCollectionArea", () => {
  let userId: string;
  let collectionId: string;
  let catalogNameId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`uca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `uca-${ts}`)).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const cn = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Deutschland", currency: "EUR" },
    });
    catalogNameId = cn.id;
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Original", description: "Old desc", primaryCatalogNameId: catalogNameId },
    });
    areaId = area.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("updates name and description", async () => {
    await updateCollectionArea(userId, areaId, { name: "Updated", description: "New desc", primaryCatalogNameId: catalogNameId });
    const found = await prisma.collectionArea.findUniqueOrThrow({ where: { id: areaId } });
    assert.equal(found.name, "Updated");
    assert.equal(found.description, "New desc");
  });

  it("clears description but keeps primary catalog", async () => {
    await updateCollectionArea(userId, areaId, { name: "Updated", description: null, primaryCatalogNameId: catalogNameId });
    const found = await prisma.collectionArea.findUniqueOrThrow({ where: { id: areaId } });
    assert.equal(found.description, null);
    assert.equal(found.primaryCatalogNameId, catalogNameId);
  });

  it("throws when clearing primary catalog on top-level area", async () => {
    await assert.rejects(
      () => updateCollectionArea(userId, areaId, { name: "Updated", primaryCatalogNameId: null }),
      /primary catalog is required/i
    );
  });

  it("throws when attempting to create a cycle", async () => {
    const ts = Date.now();
    const a = await prisma.collectionArea.create({ data: { collectionId, name: `CycleA-${ts}`, primaryCatalogNameId: catalogNameId } });
    const b = await prisma.collectionArea.create({ data: { collectionId, name: `CycleB-${ts}`, parentId: a.id } });
    await assert.rejects(
      () => updateCollectionArea(userId, a.id, { name: `CycleA-${ts}`, parentId: b.id, primaryCatalogNameId: catalogNameId }),
      /cannot set an area as its own ancestor/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => updateCollectionArea("wrong-user", areaId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("deleteCollectionArea", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dca-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dca-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes an empty area successfully", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "ToDelete" },
    });
    await deleteCollectionArea(userId, area.id);
    const found = await prisma.collectionArea.findUnique({ where: { id: area.id } });
    assert.equal(found, null);
  });

  it("throws when area has child areas", async () => {
    const parent = await prisma.collectionArea.create({
      data: { collectionId, name: "ParentWithChild" },
    });
    await prisma.collectionArea.create({
      data: { collectionId, name: "Child", parentId: parent.id },
    });
    await assert.rejects(
      () => deleteCollectionArea(userId, parent.id),
      /child area/i
    );
  });

  it("throws when area has assigned stamps", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "AreaWithStamps" },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Linked" } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id },
    });
    await assert.rejects(
      () => deleteCollectionArea(userId, area.id),
      /assigned stamp/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Protected" },
    });
    await assert.rejects(
      () => deleteCollectionArea("wrong-user", area.id),
      /access denied/i
    );
  });
});

describe("syncAreaCatalogBooks / syncAreaVendors (#675)", () => {
  // The write path is two lists, not one. It used to be a single call keyed by book that *derived*
  // the vendor rows with "non-null prefix wins, else last wins", so two Michel volumes with two
  // prefix boxes stored one value and threw the other away, and a vendor could not be recorded at
  // all without attaching one of its books.
  let userId: string;
  let collectionId: string;
  let michelVendorId: string;
  let scottVendorId: string;
  let michelBookId: string;
  let michelSpezialId: string;
  let scottBookId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`sace-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `sace-${ts}`)).id;
    const vendor1 = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const vendor2 = await prisma.catalogVendor.create({
      data: { collectionId, name: "Scott", abbreviation: "Sc" },
    });
    michelVendorId = vendor1.id;
    scottVendorId = vendor2.id;
    michelBookId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor1.id, name: "Deutschland", currency: "EUR" },
      })
    ).id;
    michelSpezialId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor1.id, name: "Deutschland Spezial", currency: "EUR" },
      })
    ).id;
    scottBookId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor2.id, name: "USA", currency: "USD" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function areaById(areaId: string) {
    const areas = await getCollectionAreas(userId, collectionId);
    const area = areas.find((a) => a.id === areaId);
    assert.ok(area);
    return area;
  }

  it("stores one vendor row for an area holding two books of that vendor", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, {
      name: "TwoVolumes",
      primaryCatalogNameId: michelBookId,
      catalogPrefix: "DE",
    });
    await syncAreaCatalogBooks(userId, areaId, [michelBookId, michelSpezialId]);
    await syncAreaVendors(userId, areaId, [{ catalogVendorId: michelVendorId }]);

    const area = await areaById(areaId);
    assert.equal(area.catalogEntries.length, 2);
    assert.equal(area.vendorEntries.length, 1);
    assert.equal(area.vendorEntries[0].catalogVendorId, michelVendorId);
    // The ordinary tick states nothing about the prefix, so the area's own answers for both books.
    assert.equal(area.vendorEntries[0].areaPrefix, null);
    assert.deepEqual(new Set(area.catalogEntries.map((e) => e.prefix)), new Set(["DE"]));
  });

  it("round-trips a vendor recorded with no book of its own", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, {
      name: "NoBook",
      primaryCatalogNameId: michelBookId,
    });
    await syncAreaCatalogBooks(userId, areaId, [michelBookId]);
    await syncAreaVendors(userId, areaId, [
      { catalogVendorId: michelVendorId },
      { catalogVendorId: scottVendorId, areaPrefix: "US" },
    ]);

    const area = await areaById(areaId);
    assert.equal(area.catalogEntries.length, 1);
    const scott = area.vendorEntries.find((v) => v.catalogVendorId === scottVendorId);
    assert.ok(scott);
    assert.equal(scott.areaPrefix, "US");
  });

  it("stores a blank prefix as inherit, and a marked one as no prefix", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, {
      name: "Blanks",
      primaryCatalogNameId: michelBookId,
      catalogPrefix: "  ",
    });
    await syncAreaVendors(userId, areaId, [
      { catalogVendorId: michelVendorId, areaPrefix: "   " },
      { catalogVendorId: scottVendorId, areaPrefix: null },
    ]);

    const area = await areaById(areaId);
    // The area prefix is two-state: a blank field is "inherit", never a stored blank.
    assert.equal(area.catalogPrefix, null);
    const michel = area.vendorEntries.find((v) => v.catalogVendorId === michelVendorId);
    // Whitespace is never a prefix; it is the stated "no prefix here".
    assert.equal(michel?.areaPrefix, "");
    const scott = area.vendorEntries.find((v) => v.catalogVendorId === scottVendorId);
    assert.equal(scott?.areaPrefix, null);
  });

  it("replaces both lists wholesale on re-sync", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, {
      name: "ReplaceTest",
      primaryCatalogNameId: michelBookId,
    });
    await syncAreaCatalogBooks(userId, areaId, [michelBookId]);
    await syncAreaVendors(userId, areaId, [{ catalogVendorId: michelVendorId, areaPrefix: "old" }]);
    await syncAreaCatalogBooks(userId, areaId, [scottBookId]);
    await syncAreaVendors(userId, areaId, [{ catalogVendorId: scottVendorId, areaPrefix: "new" }]);

    const area = await areaById(areaId);
    assert.equal(area.catalogEntries.length, 1);
    assert.equal(area.catalogEntries[0].catalogNameId, scottBookId);
    assert.deepEqual(area.vendorEntries, [
      {
        catalogVendorId: scottVendorId,
        vendorName: "Scott",
        vendorAbbreviation: "Sc",
        areaPrefix: "new",
      },
    ]);
  });

  it("syncing with empty arrays removes every row", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, {
      name: "ClearTest",
      primaryCatalogNameId: michelBookId,
    });
    await syncAreaCatalogBooks(userId, areaId, [michelBookId]);
    await syncAreaVendors(userId, areaId, [{ catalogVendorId: michelVendorId, areaPrefix: "x" }]);
    await syncAreaCatalogBooks(userId, areaId, []);
    await syncAreaVendors(userId, areaId, []);

    const area = await areaById(areaId);
    assert.equal(area.catalogEntries.length, 0);
    assert.equal(area.vendorEntries.length, 0);
  });

  it("throws when a book or a vendor belongs to a different collection", async () => {
    const ts = Date.now();
    const otherUser = await createTestUser(`sace-other-${ts}`);
    const otherCollection = await createTestCollection(otherUser.id, `sace-other-${ts}`);
    const otherVendor = await prisma.catalogVendor.create({
      data: { collectionId: otherCollection.id, name: "Scott", abbreviation: "Sc" },
    });
    const otherCn = await prisma.catalogName.create({
      data: { vendorId: otherVendor.id, name: "USA", currency: "USD" },
    });
    const { id: areaId } = await createCollectionArea(userId, collectionId, {
      name: "BadCatalog",
      primaryCatalogNameId: michelBookId,
    });
    await assert.rejects(
      () => syncAreaCatalogBooks(userId, areaId, [otherCn.id]),
      /catalog name not found/i
    );
    await assert.rejects(
      () => syncAreaVendors(userId, areaId, [{ catalogVendorId: otherVendor.id }]),
      /catalog vendor not found/i
    );
    await prisma.collection.deleteMany({ where: { ownerId: otherUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("throws when collection is not owned by user", async () => {
    const { id: areaId } = await createCollectionArea(userId, collectionId, {
      name: "AuthTest",
      primaryCatalogNameId: michelBookId,
    });
    await assert.rejects(() => syncAreaCatalogBooks("wrong-user", areaId, []), /access denied/i);
    await assert.rejects(() => syncAreaVendors("wrong-user", areaId, []), /access denied/i);
  });
});

describe("area title translations", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`tr-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `tr-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("stores per-language title names on create and reads them back", async () => {
    const { id } = await createCollectionArea(userId, collectionId, {
      name: "Poland",
      titleName: "Poland",
      translations: { pl: { titleName: "Polska" }, de: { titleName: "Polen" } },
      assignable: false,
    });
    const area = (await getCollectionAreas(userId, collectionId)).find((a) => a.id === id);
    assert.ok(area);
    assert.equal(area.titleName, "Poland");
    assert.deepEqual(area.titleNameByLanguage, { pl: "Polska", de: "Polen" });
  });

  it("updates a translation and drops it when cleared", async () => {
    const { id } = await createCollectionArea(userId, collectionId, {
      name: "Germany",
      titleName: "Germany",
      translations: { pl: { titleName: "Niemcy" } },
      assignable: false,
    });
    await updateCollectionArea(userId, id, {
      name: "Germany",
      titleName: "Germany",
      translations: { pl: { titleName: "Rzesza Niemiecka" } },
      assignable: false,
    });
    let area = (await getCollectionAreas(userId, collectionId)).find((a) => a.id === id);
    assert.equal(area?.titleNameByLanguage.pl, "Rzesza Niemiecka");

    await updateCollectionArea(userId, id, {
      name: "Germany",
      titleName: "Germany",
      translations: { pl: { titleName: "  " } },
      assignable: false,
    });
    area = (await getCollectionAreas(userId, collectionId)).find((a) => a.id === id);
    assert.deepEqual(area?.titleNameByLanguage, {});
  });

  it("leaves languages absent from the update untouched", async () => {
    const { id } = await createCollectionArea(userId, collectionId, {
      name: "Austria",
      translations: { pl: { titleName: "Austria" }, de: { titleName: "Österreich" } },
      assignable: false,
    });
    await updateCollectionArea(userId, id, {
      name: "Austria",
      translations: { pl: { titleName: "Austro-Węgry" } },
      assignable: false,
    });
    const area = (await getCollectionAreas(userId, collectionId)).find((a) => a.id === id);
    assert.deepEqual(area?.titleNameByLanguage, { pl: "Austro-Węgry", de: "Österreich" });
  });

  it("cascade-deletes translations with the area", async () => {
    const { id } = await createCollectionArea(userId, collectionId, {
      name: "Hungary",
      translations: { pl: { titleName: "Węgry" } },
      assignable: false,
    });
    await deleteCollectionArea(userId, id);
    const rows = await prisma.collectionAreaTranslation.findMany({
      where: { collectionAreaId: id },
    });
    assert.equal(rows.length, 0);
  });

  it("derives the translation languages from the platforms, minus the default language", async () => {
    assert.deepEqual(await getCollectionTitleLanguages(userId, collectionId), []);
    await prisma.contact.createMany({
      data: [
        { collectionId, name: "Allegro", platform: true, titleLanguage: "pl" },
        { collectionId, name: "Delcampe", platform: true, titleLanguage: "en" },
        { collectionId, name: "Delcampe FR", platform: true, titleLanguage: "en" },
        { collectionId, name: "Ricardo", platform: true, titleLanguage: "de" },
        { collectionId, name: "Jan Kowalski", seller: true, titleLanguage: null },
      ],
    });
    // The collection's own text is English (the migration default), so the English platforms need
    // no translation row — only the genuinely foreign languages show up.
    assert.deepEqual(await getCollectionTitleLanguages(userId, collectionId), ["de", "pl"]);

    // Switching the default language moves which platform is the "free" one.
    await setCollectionDefaultLanguage(userId, collectionId, "pl");
    assert.deepEqual(await getCollectionTitleLanguages(userId, collectionId), ["de", "en"]);
    await setCollectionDefaultLanguage(userId, collectionId, "en");
  });
});
