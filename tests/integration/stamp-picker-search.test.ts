import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { searchStampsForPicker } from "../../src/lib/stamps";

// Catalog-number recall on the stamp picker (#104): the query box takes a full catalog identity in
// any spacing, so the database net has to reach the right stamp before the normalized-key precision
// pass can pick it. Digit-free numbering (Michel's Roman local issues, "Mi·RU-BW IIIA") is covered
// alongside the ordinary numeric case, because it is the one shape a digits-only net never recalls.

describe("searchStampsForPicker catalog recall", () => {
  let userId: string;
  let collectionId: string;
  let polandStampId: string;
  let romanStampId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-picker-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User picker-${ts}`,
        email: `test-picker-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-picker-${ts}`,
          name: `Collection picker-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;

    const mi = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });

    /** An area with a per-vendor Michel prefix, plus one stamp carrying `number` in it.
     * Names stay free of the run's timestamp: the picker also recalls on a name substring, and a
     * `Date.now()` that happens to contain the queried number ("…200…") makes every fixture stamp
     * a name hit — a flake that only fires on some runs. Uniqueness comes from the fresh
     * collection these live in, which is what the search is scoped to. */
    async function makeArea(name: string, prefix: string, number: string): Promise<string> {
      const area = await prisma.collectionArea.create({ data: { collectionId, name } });
      await prisma.collectionAreaVendor.create({
        data: { collectionAreaId: area.id, catalogVendorId: mi.id, areaPrefix: prefix },
      });
      const stamp = await prisma.stamp.create({
        data: { collectionId, name: `${name} stamp`, issuedYear: 1945 },
      });
      await prisma.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
      });
      await prisma.stampCatalogNumber.create({
        data: { stampId: stamp.id, catalogVendorId: mi.id, number },
      });
      return stamp.id;
    }

    polandStampId = await makeArea("Poland", "PL", "200");
    // Filed as "IIIa" while a collector would type "IIIA": recall must ignore case here.
    romanStampId = await makeArea("Russia BW", "RU-BW", "IIIa");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const ids = async (query: string) =>
    (await searchStampsForPicker(userId, collectionId, query)).map((h) => h.stampId);

  it("finds a numeric catalog number in every spacing", async () => {
    for (const query of ["200", "Mi PL 200", "MiPL200", "PL200"]) {
      assert.deepEqual(await ids(query), [polandStampId], `query: ${query}`);
    }
  });

  it("finds a digit-free catalog number (Michel Roman local issues)", async () => {
    for (const query of ["IIIA", "Mi RU-BW IIIA", "RU-BW IIIA", "IIIa"]) {
      assert.deepEqual(await ids(query), [romanStampId], `query: ${query}`);
    }
  });

  it("does not turn a plain word query into a catalog hit", async () => {
    assert.deepEqual(await ids("IIIB"), [], "a near-miss numeral is not a match");
  });
});

// A **variant** number in a collection large enough to drown it. `7c`, `7cI` and `7cII` are
// three different stamps, and a net woven on the digit run alone catches every number carrying a
// "7" — thousands of them here, more than the candidate cap — so the one asked for never reached
// the precision pass and the search answered "nothing", in the app's picker and in the Assistant's
// search window alike.
describe("searchStampsForPicker recall in a crowded collection", () => {
  let userId: string;
  let collectionId: string;
  let variantStampId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-crowded-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User crowded-${ts}`,
        email: `test-crowded-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-crowded-${ts}`,
          name: `Collection crowded-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    const fi = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });
    const area = await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } });
    await prisma.collectionAreaVendor.create({
      data: { collectionAreaId: area.id, catalogVendorId: fi.id, areaPrefix: "PL" },
    });

    async function fileStamps(numbers: string[]): Promise<string[]> {
      const stamps = await prisma.stamp.createManyAndReturn({
        data: numbers.map(() => ({ collectionId, issuedYear: 1918 })),
        select: { id: true },
      });
      await prisma.stampCollectionArea.createMany({
        data: stamps.map((s) => ({ stampId: s.id, collectionAreaId: area.id, isPrimary: true })),
      });
      await prisma.stampCatalogNumber.createMany({
        data: stamps.map((s, i) => ({
          stampId: s.id,
          catalogVendorId: fi.id,
          number: numbers[i],
        })),
      });
      return stamps.map((s) => s.id);
    }

    // Every one of these carries a "7", and there are more of them than the recall cap. Filed
    // *before* the variant, so the cap cuts exactly where the collector's stamp is.
    await fileStamps(Array.from({ length: 2000 }, (_, i) => `${700 + i}`));
    [variantStampId] = await fileStamps(["7cII"]);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const ids = async (query: string) =>
    (await searchStampsForPicker(userId, collectionId, query)).map((h) => h.stampId);

  it("finds a variant number behind thousands sharing its digit run", async () => {
    for (const query of ["7cII", "7cii", "Fi PL 7cII", "PL7cII", "FiPL7cII"]) {
      assert.deepEqual(await ids(query), [variantStampId], `query: ${query}`);
    }
  });
});
