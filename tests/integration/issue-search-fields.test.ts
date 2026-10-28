import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listIssuesPaginated, listIssueYearFacets } from "../../src/lib/issues";
import type { IssueSearchField } from "../../src/lib/issue-search-fields";

// #2239: the Issues list's search box matches only the fields ticked beside it. `738` is made to
// read as every field at once — an issue's name, a stamp's name in an issue, a declared catalogue
// range and an issue's own number — so each field ticked alone has to find its own issue and
// nothing else.

const ts = Date.now();

describe("issue search narrowed to the ticked fields", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  const ids: Record<IssueSearchField, string> = {
    issueName: "",
    stampName: "",
    catalogNumber: "",
    issueNumber: "",
  };

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-issuesearchfields-${ts}`,
          name: "Issue search fields",
          email: `test-issuesearchfields-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-issuesearchfields-${ts}`, name: "S", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const collectionAreaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const issue = (issueNo: number, name: string) =>
      prisma.issue.create({ data: { collectionId, collectionAreaId, issueNo, name } });

    ids.issueName = (await issue(1, "Series 738")).id;
    ids.stampName = (await issue(2, "Chopin")).id;
    await prisma.stamp.create({
      data: { collectionId, name: "Overprint 738", issueMemberships: { create: [{ issueId: ids.stampName }] } },
    });
    ids.catalogNumber = (await issue(3, "Moniuszko")).id;
    await prisma.issueCatalogNumber.create({
      data: { issueId: ids.catalogNumber, catalogVendorId: vendorId, firstNumber: "738" },
    });
    ids.issueNumber = (await issue(738, "Szymanowski")).id;
  });

  after(async () => {
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const found = async (
    search: string,
    searchFields?: IssueSearchField[],
    extra: { searchCatalogNumber?: string; searchCatalogVendorId?: string } = {}
  ) =>
    (await listIssuesPaginated(userId, collectionId, { search, searchFields, ...extra })).items
      .map((i) => i.id)
      .sort();

  it("matches every field when nothing is narrowed", async () => {
    assert.deepEqual(await found("738"), Object.values(ids).sort());
  });

  it("matches only the field ticked", async () => {
    for (const field of Object.keys(ids) as IssueSearchField[]) {
      assert.deepEqual(await found("738", [field]), [ids[field]], field);
    }
  });

  it("matches any of several ticked fields", async () => {
    assert.deepEqual(
      await found("738", ["issueName", "issueNumber"]),
      [ids.issueName, ids.issueNumber].sort()
    );
  });

  it("matches nothing for text that is no number with only Issue number ticked", async () => {
    assert.deepEqual(await found("Series", ["issueNumber"]), []);
  });

  it("keeps #N the issue number alone, whatever is ticked", async () => {
    // The client parses `#738` into a bare catalogue number too; it reaches no declared range.
    const parsed = { searchCatalogNumber: "738" };
    assert.deepEqual(await found("#738", undefined, parsed), [ids.issueNumber]);
    assert.deepEqual(await found("#738", ["issueName"], parsed), [ids.issueNumber]);
  });

  it("keeps a vendor-prefixed catalogue number within Catalogue number", async () => {
    const prefixed = { searchCatalogNumber: "738", searchCatalogVendorId: vendorId };
    assert.deepEqual(await found("Mi 738", ["catalogNumber"], prefixed), [ids.catalogNumber]);
    assert.deepEqual(await found("Mi 738", ["issueName", "stampName"], prefixed), []);
  });

  it("counts the year rail under the same narrowing", async () => {
    const facets = await listIssueYearFacets(userId, collectionId, {
      search: "738",
      searchFields: ["stampName"],
    });
    assert.deepEqual(
      facets.map((f) => f.count),
      [1]
    );
  });
});
