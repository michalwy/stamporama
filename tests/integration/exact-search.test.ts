import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";
import { listStampsPaginated } from "../../src/lib/stamps";
import { listIssuesPaginated } from "../../src/lib/issues";
import { listWantsPaginated } from "../../src/lib/wants";
import { listAuctionSales } from "../../src/lib/auctions";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import type { CopySearchField } from "../../src/lib/copy-search-fields";

// #2545: a search typed in double quotes matches whole values. The list routes take the quotes off
// and set `searchExact`; the `where` builders then ask each ticked field for equality, letter case
// aside — `"A111"` is A111 and not A1110, `"200"` is 200 and not 200a or 1200.

const ts = Date.now();

describe("a search in double quotes matches exactly", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  const copies: Record<string, string> = {};
  const stamps: Record<string, string> = {};
  const issues: Record<string, string> = {};
  const wants: Record<string, string> = {};

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-exactsearch-${ts}`,
          name: "Exact search",
          email: `test-exactsearch-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-exactsearch-${ts}`, name: "E", baseCurrency: "EUR", ownerId: userId },
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

    for (const number of ["200", "200a", "1200"]) {
      const issue = await prisma.issue.create({
        data: {
          collectionId,
          collectionAreaId: area.id,
          issueNo: Object.keys(issues).length + 1,
          name: `Issue ${number}`,
        },
      });
      issues[number] = issue.id;
      stamps[number] = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${number}`,
            catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
            issueMemberships: { create: [{ issueId: issue.id }] },
          },
        })
      ).id;
      wants[number] = (
        await prisma.want.create({ data: { collectionId, stampId: stamps[number] } })
      ).id;
    }

    // Two copies filed under refs one of which is the other's prefix.
    const locationId = (
      await prisma.location.create({ data: { collectionId, name: "Box", code: "B", assignable: true } })
    ).id;
    for (const ref of ["A111", "A1110"]) {
      copies[ref] = (
        await createItem(userId, collectionId, {
          stampId: stamps["200"],
          conditionId,
          locationId,
          locationRef: ref,
        })
      ).id;
    }
    for (const number of ["200", "200a", "1200"]) {
      copies[number] = (await createItem(userId, collectionId, { stampId: stamps[number], conditionId })).id;
    }

    const sellerId = (await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })).id;
    const platformId = (await prisma.platform.create({ data: { collectionId, name: "Allegro" } })).id;
    for (const name of ["Gärtner", "Gärtner & Co"]) {
      await prisma.auctionSale.create({ data: { collectionId, name, currency: "EUR", sellerId, platformId } });
    }
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.platform.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.want.deleteMany({ where: { collectionId } });
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

  /** The Copies list as its route reads the query — quotes and all. */
  const copiesFound = async (search: string, fields?: CopySearchField[], extra: Record<string, string> = {}) =>
    (
      await listItemsPaginated(
        userId,
        collectionId,
        readItemFilters(
          new URLSearchParams({ search, ...(fields ? { searchFields: fields.join(",") } : {}), ...extra })
        )
      )
    ).items
      .map((i) => i.id)
      .sort();

  it("Copies: a quoted location ref finds that ref and not a longer one", async () => {
    assert.deepEqual(await copiesFound('"A111"', ["locationRef"]), [copies.A111]);
    assert.deepEqual(await copiesFound('"a111"', ["locationRef"]), [copies.A111], "letter case");
    assert.deepEqual(
      await copiesFound("A111", ["locationRef"]),
      [copies.A111, copies.A1110].sort(),
      "without quotes, as before"
    );
  });

  it("Copies: a search only partly in quotes is plain text", async () => {
    assert.deepEqual(await copiesFound('"A111', ["locationRef"]), []);
  });

  it("Copies: a quoted catalogue number is the number — the parsed one too", async () => {
    // The panel sends the number it parsed out of the unquoted text, as for any prefixed search.
    const exact200 = [copies["200"], copies.A111, copies.A1110].sort();
    assert.deepEqual(await copiesFound('"200"', ["catalogNumber"], { catalogNumber: "200" }), exact200);
    assert.deepEqual(
      await copiesFound('"Mi 200"', ["catalogNumber"], { catalogNumber: "200", catalogVendorId: vendorId }),
      exact200
    );
    assert.equal((await copiesFound("200", ["catalogNumber"], { catalogNumber: "200" })).length, 5);
  });

  it("Stamps: a quoted catalogue number finds 200 and not 200a or 1200", async () => {
    const found = async (search: string, searchExact?: boolean) =>
      (
        await listStampsPaginated(userId, collectionId, {
          search,
          searchExact,
          searchFields: ["catalogNumber"],
        })
      ).items
        .map((s) => s.id)
        .sort();
    assert.deepEqual(await found("200", true), [stamps["200"]]);
    assert.deepEqual(await found("200A", true), [stamps["200a"]], "letter case");
    assert.deepEqual(await found("200"), [stamps["200"], stamps["200a"], stamps["1200"]].sort());
  });

  it("Issues: a quoted name or number is the whole value", async () => {
    const found = async (search: string, extra: { searchCatalogNumber?: string } = {}) =>
      (await listIssuesPaginated(userId, collectionId, { search, searchExact: true, ...extra })).items
        .map((i) => i.id)
        .sort();
    assert.deepEqual(await found("issue 200"), [issues["200"]]);
    assert.deepEqual(await found("200", { searchCatalogNumber: "200" }), [issues["200"]]);
  });

  it("Wants: a quoted catalogue number finds that stamp's want only", async () => {
    const { items } = await listWantsPaginated(userId, collectionId, {
      search: "200",
      searchExact: true,
      searchFields: ["catalogNumber"],
    });
    assert.deepEqual(
      items.map((w) => w.id),
      [wants["200"]]
    );
  });

  it("auction sales: a quoted name is that name, not a longer one", async () => {
    const names = async (searchExact?: boolean) =>
      (await listAuctionSales(userId, collectionId, { search: "gärtner", searchExact, searchFields: ["name"] }))
        .map((s) => s.name)
        .sort();
    assert.deepEqual(await names(true), ["Gärtner"]);
    assert.deepEqual(await names(), ["Gärtner", "Gärtner & Co"]);
  });
});
