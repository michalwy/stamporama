import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasStampFilter,
  issueHeaderMatchesCatalogFilter,
  issueHeaderMatchesSearch,
  matchStampsByCatalogFilter,
  matchStampsBySearch,
  matchedStampsInIssue,
  needsInnerStampMatch,
  type MatchVendorEntry,
} from "../../src/lib/issue-stamp-match";

const MI = "vendor-michel";
const FI = "vendor-fischer";

const VENDORS = new Map<string, MatchVendorEntry>([
  [MI, { vendorAbbreviation: "Mi", prefix: "PL" }],
  [FI, { vendorAbbreviation: "Fi", prefix: null }],
]);

/** Poland 1938, Michel 309–312, declared as a range. */
const ISSUE = {
  name: "Birds of Poland",
  year: 1938,
  issueNo: 42,
  catalogNumbers: [{ catalogVendorId: MI, firstNumber: "309", lastNumber: "312" }],
};

const stamp = (
  stampId: string,
  name: string | null,
  numbers: { catalogVendorId: string; number: string }[] = []
) => ({ stampId, name, catalogNumbers: numbers });

const TREE = [
  stamp("s-309", null, [{ catalogVendorId: MI, number: "309" }]),
  stamp("s-309A", null, [{ catalogVendorId: MI, number: "309A" }]),
  stamp("s-309AP", "Perforated print", [{ catalogVendorId: MI, number: "309AP" }]),
  stamp("s-310", null, [{ catalogVendorId: MI, number: "310" }, { catalogVendorId: FI, number: "BL31" }]),
];

describe("issueHeaderMatchesSearch", () => {
  it("an empty search is explained by every header", () => {
    assert.equal(issueHeaderMatchesSearch(ISSUE, "  ", VENDORS), true);
  });

  it("matches the issue's own name, year and short number", () => {
    assert.equal(issueHeaderMatchesSearch(ISSUE, "birds", VENDORS), true);
    assert.equal(issueHeaderMatchesSearch(ISSUE, "1938", VENDORS), true);
    assert.equal(issueHeaderMatchesSearch(ISSUE, "#42", VENDORS), true);
  });

  it("matches the declared range in any spacing", () => {
    for (const q of ["Mi PL 309", "MiPL309", "PL309", "309"]) {
      assert.equal(issueHeaderMatchesSearch(ISSUE, q, VENDORS), true, q);
    }
  });

  it("does not explain a hit that can only have come from a stamp", () => {
    assert.equal(issueHeaderMatchesSearch(ISSUE, "309AP", VENDORS), false);
  });
});

describe("matchStampsBySearch", () => {
  it("matches a stamp by name", () => {
    assert.deepEqual([...matchStampsBySearch(TREE, "perforated", VENDORS)], ["s-309AP"]);
  });

  it("matches a stamp by catalog number, prefixed or bare", () => {
    for (const q of ["Mi PL 309AP", "MiPL309AP", "309ap"]) {
      assert.deepEqual([...matchStampsBySearch(TREE, q, VENDORS)], ["s-309AP"], q);
    }
  });

  it("reaches a secondary catalog's number through its own digit run", () => {
    assert.deepEqual([...matchStampsBySearch(TREE, "Fi BL31", VENDORS)], ["s-310"]);
  });

  it("matches nothing for an empty search", () => {
    assert.equal(matchStampsBySearch(TREE, "", VENDORS).size, 0);
  });
});

describe("the catalog filter", () => {
  it("matches the issue's declared range exactly, never by prefix", () => {
    assert.equal(issueHeaderMatchesCatalogFilter(ISSUE, { catalogNumber: "309" }), true);
    assert.equal(issueHeaderMatchesCatalogFilter(ISSUE, { catalogNumber: "309A" }), false);
  });

  it("narrows to a vendor when one is named", () => {
    assert.equal(
      issueHeaderMatchesCatalogFilter(ISSUE, { catalogNumber: "309", catalogVendorId: FI }),
      false
    );
  });

  it("matches a member stamp's number exactly", () => {
    assert.deepEqual([...matchStampsByCatalogFilter(TREE, { catalogNumber: "309A" })], ["s-309A"]);
    assert.equal(matchStampsByCatalogFilter(TREE, { catalogNumber: "309" }).size, 1);
  });

  it("matches nothing without a number, whatever vendor is set", () => {
    assert.equal(matchStampsByCatalogFilter(TREE, { catalogVendorId: MI }).size, 0);
  });
});

describe("hasStampFilter / needsInnerStampMatch", () => {
  it("an empty query narrows on no stamp", () => {
    assert.equal(hasStampFilter({}), false);
    assert.equal(hasStampFilter({ search: "   " }), false);
    assert.equal(needsInnerStampMatch(ISSUE, {}, VENDORS), false);
  });

  it("a filter the header explains needs no tree read", () => {
    assert.equal(needsInnerStampMatch(ISSUE, { search: "birds" }, VENDORS), false);
    assert.equal(needsInnerStampMatch(ISSUE, { catalogNumber: "312" }, VENDORS), false);
  });

  it("a filter the header cannot explain does", () => {
    assert.equal(needsInnerStampMatch(ISSUE, { search: "309AP" }, VENDORS), true);
    assert.equal(needsInnerStampMatch(ISSUE, { catalogNumber: "309A" }, VENDORS), true);
  });
});

describe("matchedStampsInIssue", () => {
  it("says nothing about a tree with no stamp-level filter", () => {
    assert.equal(matchedStampsInIssue(ISSUE, TREE, {}, VENDORS), null);
  });

  it("says nothing when the issue's own header explains the hit", () => {
    // The row surfaced on its name, so every stamp under it belongs on screen.
    assert.equal(matchedStampsInIssue(ISSUE, TREE, { search: "birds" }, VENDORS), null);
  });

  it("picks out the stamps a search reached the issue through", () => {
    const matched = matchedStampsInIssue(ISSUE, TREE, { search: "309AP" }, VENDORS);
    assert.deepEqual([...matched!], ["s-309AP"]);
  });

  it("intersects several active filters, as the server ANDs them", () => {
    const matched = matchedStampsInIssue(
      ISSUE,
      TREE,
      { search: "perforated", catalogNumber: "309AP" },
      VENDORS
    );
    assert.deepEqual([...matched!], ["s-309AP"]);
    assert.equal(
      matchedStampsInIssue(ISSUE, TREE, { search: "perforated", catalogNumber: "309A" }, VENDORS),
      null,
      "no stamp satisfies both, so the tree is left whole rather than emptied"
    );
  });

  it("ignores a filter the header already explained when another narrows", () => {
    // The catalog filter hit the declared range; the search did not, so only it narrows.
    const matched = matchedStampsInIssue(
      ISSUE,
      TREE,
      { search: "perforated", catalogNumber: "309" },
      VENDORS
    );
    assert.deepEqual([...matched!], ["s-309AP"]);
  });

  it("leaves the tree whole when nothing inside matched either", () => {
    assert.equal(matchedStampsInIssue(ISSUE, TREE, { search: "zzz" }, VENDORS), null);
  });
});
