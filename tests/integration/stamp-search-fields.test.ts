import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import type { Prisma } from "../../src/generated/prisma/client";
import { listStampAreaFacets, listStampsPaginated, listStampYearFacets } from "../../src/lib/stamps";
import type { StampSearchField } from "../../src/lib/stamp-search-fields";

// #2240: the Stamps list's search box matches only the fields ticked beside it. `A038` is made to
// read as every field at once — a stamp's name, an issue's name, a catalogue number, a denomination
// and a perforation — so each field ticked alone has to find its own stamp and nothing else.

const ts = Date.now();

describe("stamp search narrowed to the ticked fields", () => {
  let userId: string;
  let collectionId: string;
  const ids: Record<StampSearchField, string> = {} as Record<StampSearchField, string>;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-stampsearchfields-${ts}`,
          name: "Stamp search fields",
          email: `test-stampsearchfields-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-stampsearchfields-${ts}`, name: "S", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    await prisma.stampCondition.create({
      data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
    });
    const area = await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } });
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, issueNo: 1, name: "Series A038" },
    });
    const stamp = async (data: Omit<Prisma.StampUncheckedCreateInput, "collectionId">) =>
      (
        await prisma.stamp.create({
          data: { collectionId, stampAreaLinks: { create: [{ collectionAreaId: area.id }] }, ...data },
        })
      ).id;

    await stamp({ name: "Chopin" });
    ids.stampName = await stamp({ name: "Overprint A038" });
    ids.issueName = await stamp({
      name: "Moniuszko",
      issueMemberships: { create: [{ issueId: issue.id }] },
    });
    ids.catalogNumber = await stamp({
      name: "Szymanowski",
      catalogNumbers: { create: [{ catalogVendorId: vendorId, number: "A038" }] },
    });
    ids.denomination = await stamp({ name: "Paderewski", denomination: "A038 gr" });
    ids.perforation = await stamp({ name: "Kościuszko", perforation: "A038" });
  });

  after(async () => {
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const found = async (search: string, searchFields?: StampSearchField[]) =>
    (await listStampsPaginated(userId, collectionId, { search, searchFields })).items
      .map((s) => s.id)
      .sort();

  it("matches every field when nothing is narrowed", async () => {
    assert.deepEqual(await found("A038"), Object.values(ids).sort());
  });

  it("matches only the field ticked", async () => {
    for (const field of Object.keys(ids) as StampSearchField[]) {
      assert.deepEqual(await found("A038", [field]), [ids[field]], field);
    }
  });

  it("matches any of several ticked fields", async () => {
    assert.deepEqual(
      await found("A038", ["perforation", "stampName"]),
      [ids.stampName, ids.perforation].sort()
    );
  });

  it("narrows the year and area counts the same way", async () => {
    const opts = { search: "A038", searchFields: ["denomination"] as StampSearchField[] };
    const years = await listStampYearFacets(userId, collectionId, opts);
    assert.deepEqual(years, [{ year: null, count: 1 }]);
    const areas = await listStampAreaFacets(userId, collectionId, opts);
    assert.equal(areas.length, 1);
    assert.equal(areas[0].count, 1);
  });
});
