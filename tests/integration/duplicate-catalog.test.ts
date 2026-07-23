import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  findCatalogDuplicatesForCandidates,
  findCatalogDuplicatesForStamp,
  listCatalogDuplicates,
  getCollectionDuplicateMode,
} from "../../src/lib/duplicate-catalog";

// Detection is scoped by catalog identity = vendor + effective area prefix + exact
// number (#85). This exercises the prefix-sensitive matching: the same vendor +
// number under different area prefixes must NOT collide.
describe("duplicate-catalog detection", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  let areaDE: string;
  let areaPL: string;
  let s1: string; // Mi·DE 200
  let s2: string; // Mi·PL 200 (different prefix — not a dup of s1)
  let s3: string; // Mi·DE 200 (dup of s1)

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-dup-${ts}`,
          name: "Dup Test",
          email: `dup-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-dup-${ts}`, name: "Dup", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    areaDE = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })
    ).id;
    areaPL = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
    await prisma.collectionAreaVendor.createMany({
      data: [
        { collectionAreaId: areaDE, catalogVendorId: vendorId, areaPrefix: "DE" },
        { collectionAreaId: areaPL, catalogVendorId: vendorId, areaPrefix: "PL" },
      ],
    });

    async function makeStamp(name: string, areaId: string, number: string) {
      const stamp = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
      });
      await prisma.stampCatalogNumber.create({
        data: { stampId: stamp.id, catalogVendorId: vendorId, number },
      });
      return stamp.id;
    }
    s1 = await makeStamp("S1", areaDE, "200");
    s2 = await makeStamp("S2", areaPL, "200");
    s3 = await makeStamp("S3", areaDE, "200");
  });

  after(async () => {
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("defaults to warn mode", async () => {
    assert.equal(await getCollectionDuplicateMode(userId, collectionId), "warn");
  });

  it("reports only same-prefix collisions collection-wide", async () => {
    const groups = await listCatalogDuplicates(userId, collectionId);
    assert.equal(groups.length, 1, "only Mi·DE 200 is a duplicate");
    assert.equal(groups[0].label, "Mi·DE 200");
    const ids = groups[0].stamps.map((s) => s.stampId).sort();
    assert.deepEqual(ids, [s1, s3].sort());
  });

  it("matches candidates against the context area's prefix", async () => {
    const inDE = await findCatalogDuplicatesForCandidates(
      userId,
      collectionId,
      areaDE,
      [{ catalogVendorId: vendorId, number: "200" }],
      null
    );
    assert.deepEqual(
      inDE.flatMap((g) => g.stamps.map((s) => s.stampId)).sort(),
      [s1, s3].sort()
    );

    const inPL = await findCatalogDuplicatesForCandidates(
      userId,
      collectionId,
      areaPL,
      [{ catalogVendorId: vendorId, number: "200" }],
      null
    );
    assert.deepEqual(
      inPL.flatMap((g) => g.stamps.map((s) => s.stampId)),
      [s2]
    );
  });

  it("excludes the edited stamp and uses its own primary area", async () => {
    // Editing S1 (Mi·DE 200): S3 collides, S1 itself is excluded.
    const groups = await findCatalogDuplicatesForStamp(userId, collectionId, s1, [
      { catalogVendorId: vendorId, number: "200" },
    ]);
    assert.deepEqual(
      groups.flatMap((g) => g.stamps.map((s) => s.stampId)),
      [s3]
    );
  });

  it("treats a different number as no collision (exact match)", async () => {
    const groups = await findCatalogDuplicatesForCandidates(
      userId,
      collectionId,
      areaDE,
      [{ catalogVendorId: vendorId, number: "200a" }],
      null
    );
    assert.equal(groups.length, 0);
  });
});
