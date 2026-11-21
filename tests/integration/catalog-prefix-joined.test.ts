import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { readCollectionAreas, syncAreaVendors, updateCollectionArea } from "../../src/lib/areas";
import { buildAreaVendorMaps, formatStampCN } from "../../src/lib/area-vendor";
import { catalogSearchValue } from "../../src/lib/catalog-number";
import { listCatalogDuplicates } from "../../src/lib/duplicate-catalog";
import { loadIssuePrefixMap } from "../../src/lib/issue-prefix";

// A catalog prefix that joins its number with no space (#2657): `DR D` + `12` reads `DR D12`. The
// joining is stored beside each of the three prefixes, resolved with the prefix it belongs to, and
// kept by a write that does not mention it.
describe("catalog prefix joined to the number (#2657)", () => {
  let userId: string;
  let collectionId: string;
  let michel: string;
  let dienst: string; // `DR D`, joined
  let laender: string; // child of Dienst, says nothing
  let poland: string; // `PL`, the ordinary spaced prefix
  let group: string; // grouping-only, for the write paths

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-joined-${ts}`,
          name: "Joined Test",
          email: `joined-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-joined-${ts}`, name: "Joined", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    michel = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    dienst = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Dienst", catalogPrefix: "DR D", catalogPrefixJoined: true },
      })
    ).id;
    laender = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Länder", parentId: dienst } })
    ).id;
    poland = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland", catalogPrefix: "PL" } })
    ).id;
    group = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Group", assignable: false },
      })
    ).id;
    await prisma.collectionAreaVendor.createMany({
      data: [
        { collectionAreaId: dienst, catalogVendorId: michel, areaPrefix: null },
        { collectionAreaId: poland, catalogVendorId: michel, areaPrefix: null },
      ],
    });

    async function makeStamp(name: string, areaId: string, number: string) {
      const stamp = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
      });
      await prisma.stampCatalogNumber.create({ data: { stampId: stamp.id, catalogVendorId: michel, number } });
    }
    await makeStamp("Dienst 12", laender, "12");
    await makeStamp("Dienst 12 again", laender, "12");
    await makeStamp("Poland 123", poland, "123");
  });

  after(async () => {
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("labels a child that says nothing with the inherited prefix and its missing space", async () => {
    const maps = buildAreaVendorMaps(await readCollectionAreas(collectionId), await loadIssuePrefixMap(collectionId));
    const entry = maps.vendorMapFor(laender, null).get(michel);
    assert.equal(formatStampCN("12", entry), "Mi·DR D12");
    assert.equal(catalogSearchValue(entry?.prefix, "12", entry?.prefixJoined ?? false), "DR D12");
    // An existing prefix keeps its space.
    assert.equal(formatStampCN("123", maps.vendorMapFor(poland, null).get(michel)), "Mi·PL 123");
  });

  it("flags a second 12 in the same area and catalogue as a duplicate, labelled joined", async () => {
    const groups = await listCatalogDuplicates(userId, collectionId);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Mi·DR D12");
    assert.equal(groups[0].stamps.length, 2);
  });

  it("keeps the area's joining when a write does not mention it, and clears it with the prefix", async () => {
    await updateCollectionArea(userId, group, { name: "Group", assignable: false, catalogPrefix: "X Y", catalogPrefixJoined: true });
    await updateCollectionArea(userId, group, { name: "Group", assignable: false, catalogPrefix: "X Y" });
    let row = await prisma.collectionArea.findUniqueOrThrow({ where: { id: group } });
    assert.equal(row.catalogPrefixJoined, true);

    await updateCollectionArea(userId, group, { name: "Group", assignable: false, catalogPrefix: "" });
    row = await prisma.collectionArea.findUniqueOrThrow({ where: { id: group } });
    assert.equal(row.catalogPrefix, null);
    assert.equal(row.catalogPrefixJoined, false, "a joining means nothing without a prefix");
  });

  it("keeps a vendor row's joining when the list is restated without it", async () => {
    await syncAreaVendors(userId, group, [{ catalogVendorId: michel, areaPrefix: "PL TP W", prefixJoined: true }]);
    await syncAreaVendors(userId, group, [{ catalogVendorId: michel, areaPrefix: "PL TP W" }]);
    let row = await prisma.collectionAreaVendor.findUniqueOrThrow({
      where: { collectionAreaId_catalogVendorId: { collectionAreaId: group, catalogVendorId: michel } },
    });
    assert.equal(row.prefixJoined, true);

    // An inheriting row states no prefix, so it carries no joining of its own.
    await syncAreaVendors(userId, group, [{ catalogVendorId: michel, areaPrefix: null, prefixJoined: true }]);
    row = await prisma.collectionAreaVendor.findUniqueOrThrow({
      where: { collectionAreaId_catalogVendorId: { collectionAreaId: group, catalogVendorId: michel } },
    });
    assert.equal(row.prefixJoined, false);
  });
});
