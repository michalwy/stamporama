import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareIssueGroups, issueGroupLabel } from "../../src/lib/issue-groups";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

// Grouping the Copies list by issue (#424). What is worth pinning down is the *reading order* — the
// whole reason the grouping is paged in memory rather than in SQL, and the reason it can neither
// repeat nor skip a group across a page boundary — and how a group is named.

describe("compareIssueGroups", () => {
  // Written as the catalog number a collector would read, encoded through the real formula.
  const g = (
    issueId: string | null,
    issueYear: number | null = null,
    catalogNumber: string | number | null = null,
    issueName: string | null = null
  ) => ({
    issueId,
    issueYear,
    catalogSortKey: catalogNumber === null ? null : catalogSortKeyOf(String(catalogNumber)),
    issueName,
  });

  it("orders by year, ascending — the Issues list's own order", () => {
    const sorted = [g("c", 1949), g("a", 1918), g("b", 1930)].sort(compareIssueGroups);
    assert.deepEqual(sorted.map((s) => s.issueId), ["a", "b", "c"]);
  });

  it("breaks a tied year on the primary catalog number", () => {
    const sorted = [g("b", 1949, 40), g("a", 1949, 12), g("c", 1949, 300)].sort(compareIssueGroups);
    assert.deepEqual(sorted.map((s) => s.issueId), ["a", "b", "c"]);
  });

  it("sorts a number-less issue after the numbered ones of its year", () => {
    const sorted = [g("b", 1949, null), g("a", 1949, 12)].sort(compareIssueGroups);
    assert.deepEqual(sorted.map((s) => s.issueId), ["a", "b"]);
  });

  it("sorts a year-less issue after the dated ones", () => {
    const sorted = [g("b", null), g("a", 1949)].sort(compareIssueGroups);
    assert.deepEqual(sorted.map((s) => s.issueId), ["a", "b"]);
  });

  it("falls through to the name, then the id, so the order is total", () => {
    const sorted = [g("b", 1949, 12, "Sport"), g("a", 1949, 12, "Chopin")].sort(compareIssueGroups);
    assert.deepEqual(sorted.map((s) => s.issueId), ["a", "b"]);
    const tied = [g("b", 1949, 12, "Chopin"), g("a", 1949, 12, "Chopin")].sort(compareIssueGroups);
    assert.deepEqual(tied.map((s) => s.issueId), ["a", "b"]);
  });

  it("puts the copies belonging to no issue last, whatever the rest look like", () => {
    const sorted = [g(null), g("b", 2020), g("a", null)].sort(compareIssueGroups);
    assert.deepEqual(sorted.map((s) => s.issueId), ["b", "a", null]);
  });
});

describe("issueGroupLabel", () => {
  it("writes the name and the year the way a lot's issue header does", () => {
    assert.equal(issueGroupLabel("i1", "Chopin", 1949), "Chopin (1949)");
    assert.equal(issueGroupLabel("i1", "Chopin", null), "Chopin");
    assert.equal(issueGroupLabel("i1", null, 1949), "(1949)");
  });

  it("names an issue carrying neither, rather than rendering an empty row", () => {
    assert.equal(issueGroupLabel("i1", null, null), "Untitled issue");
    assert.equal(issueGroupLabel("i1", "   ", null), "Untitled issue");
  });

  it("names the issue-less bucket", () => {
    assert.equal(issueGroupLabel(null, null, null), "No issue");
  });
});
