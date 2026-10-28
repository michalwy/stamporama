import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listWantsPaginated } from "../../src/lib/wants";
import type { WantSearchField } from "../../src/lib/want-search-fields";

// #2241: the Want list's search box matches only the fields ticked beside it (#2238's control).
// `A038` is made to read as every field at once — a stamp's name, an issue's name, a catalogue
// number and a want's note — so each field ticked alone has to find its own want and nothing else.

const ts = Date.now();

describe("want search narrowed to the ticked fields", () => {
  let userId: string;
  let collectionId: string;
  const ids: Record<string, string> = {};
  let vendorId: string;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-wantsearchfields-${ts}`,
          name: "Want search fields",
          email: `test-wantsearchfields-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-wantsearchfields-${ts}`, name: "S", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const area = await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } });
    vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, issueNo: 1, name: "Series A038" },
    });

    const plain = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;
    const stamps = {
      stampName: (await prisma.stamp.create({ data: { collectionId, name: "Overprint A038" } })).id,
      issueName: (
        await prisma.stamp.create({
          data: { collectionId, name: "Moniuszko", issueMemberships: { create: [{ issueId: issue.id }] } },
        })
      ).id,
      catalogNumber: (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: "Szymanowski",
            catalogNumbers: { create: [{ catalogVendorId: vendorId, number: "A038" }] },
          },
        })
      ).id,
    };
    for (const [field, stampId] of Object.entries(stamps)) {
      ids[field] = (await prisma.want.create({ data: { collectionId, stampId } })).id;
    }
    ids.note = (
      await prisma.want.create({ data: { collectionId, stampId: plain, notes: "ask about A038" } })
    ).id;
  });

  after(async () => {
    await prisma.want.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const found = async (
    search: string,
    searchFields?: WantSearchField[],
    extra: { searchCatalogNumber?: string; searchCatalogVendorId?: string } = {}
  ) =>
    (await listWantsPaginated(userId, collectionId, { search, searchFields, ...extra })).items
      .map((w) => w.id)
      .sort();

  it("matches every field when nothing is narrowed", async () => {
    assert.deepEqual(
      await found("A038"),
      [ids.stampName, ids.issueName, ids.catalogNumber, ids.note].sort()
    );
  });

  it("matches only the field ticked", async () => {
    for (const field of ["stampName", "issueName", "catalogNumber", "note"] as const) {
      assert.deepEqual(await found("A038", [field]), [ids[field]], field);
    }
  });

  it("matches any of several ticked fields", async () => {
    assert.deepEqual(await found("A038", ["note", "stampName"]), [ids.stampName, ids.note].sort());
  });

  it("keeps a vendor-prefixed catalogue number within Catalogue number", async () => {
    const prefixed = { searchCatalogNumber: "A038", searchCatalogVendorId: vendorId };
    assert.deepEqual(await found("Mi A038", ["catalogNumber"], prefixed), [ids.catalogNumber]);
    assert.deepEqual(await found("Mi A038", ["note"], prefixed), []);
  });
});
