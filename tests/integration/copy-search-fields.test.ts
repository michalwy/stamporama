import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";
import type { CopySearchField } from "../../src/lib/copy-search-fields";

// #2238: the Copies list's search box matches only the fields ticked beside it. `A038` is made to
// read as every field at once — a stamp's name, an issue's name, a catalogue number and a location
// ref — so each field ticked alone has to find its own copy and nothing else.

const ts = Date.now();

describe("search narrowed to the ticked fields", () => {
  let userId: string;
  let collectionId: string;
  const ids: Record<string, string> = {};
  let byNumber: { id: string; itemNo: number };
  let vendorId: string;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-searchfields-${ts}`,
          name: "Search fields",
          email: `test-searchfields-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-searchfields-${ts}`, name: "S", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
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
      ids[field] = (await createItem(userId, collectionId, { stampId, conditionId })).id;
    }
    // A ref is kept only beside a location, so the filed copy sits in a box.
    const locationId = (
      await prisma.location.create({ data: { collectionId, name: "Box", code: "B", assignable: true } })
    ).id;
    ids.locationRef = (
      await createItem(userId, collectionId, {
        stampId: plain,
        conditionId,
        locationId,
        locationRef: "A038",
      })
    ).id;
    const numbered = await createItem(userId, collectionId, { stampId: plain, conditionId });
    byNumber = { id: numbered.id, itemNo: numbered.itemNo };
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.location.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const found = async (
    search: string,
    searchFields?: CopySearchField[],
    extra: { catalogNumber?: string; catalogVendorId?: string } = {}
  ) =>
    (await listItemsPaginated(userId, collectionId, { search, searchFields, ...extra })).items
      .map((i) => i.id)
      .sort();

  it("matches every field when nothing is narrowed", async () => {
    assert.deepEqual(
      await found("A038"),
      [ids.stampName, ids.issueName, ids.catalogNumber, ids.locationRef].sort()
    );
  });

  it("matches only the field ticked", async () => {
    for (const field of ["stampName", "issueName", "catalogNumber", "locationRef"] as const) {
      assert.deepEqual(await found("A038", [field]), [ids[field]], field);
    }
  });

  it("matches any of several ticked fields", async () => {
    assert.deepEqual(
      await found("A038", ["locationRef", "stampName"]),
      [ids.stampName, ids.locationRef].sort()
    );
  });

  it("reads a bare number as a copy number only while Copy number is ticked", async () => {
    const n = `${byNumber.itemNo}`;
    assert.deepEqual(await found(n, ["copyNumber"]), [byNumber.id]);
    assert.deepEqual(await found(n, ["stampName", "locationRef"]), []);
    // Text that is no number, with only *Copy number* ticked, matches nothing rather than all.
    assert.deepEqual(await found("A038", ["copyNumber"]), []);
  });

  it("keeps #N the copy number whatever is ticked", async () => {
    assert.deepEqual(await found(`#${byNumber.itemNo}`, ["locationRef"]), [byNumber.id]);
  });

  it("keeps a vendor-prefixed catalogue number within Catalogue number", async () => {
    const prefixed = { catalogNumber: "A038", catalogVendorId: vendorId };
    assert.deepEqual(await found("Mi A038", ["catalogNumber"], prefixed), [ids.catalogNumber]);
    assert.deepEqual(await found("Mi A038", ["locationRef"], prefixed), []);
  });
});
