import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  catalogSortKeyOf,
  computeCatalogSortKey,
  compareCatalogSortKeys,
} from "../../src/lib/catalog-sort-key";

describe("catalogSortKeyOf", () => {
  it("pads the number so a family compares numerically as text", () => {
    assert.equal(catalogSortKeyOf("200"), "0000000200");
    assert.equal(catalogSortKeyOf("  17"), "0000000017");
    assert.equal(catalogSortKeyOf("7"), "0000000007");
  });

  it("keeps the leading letters as the numbering family", () => {
    assert.equal(catalogSortKeyOf("P15"), "p0000000015");
    assert.equal(catalogSortKeyOf("Bl 3"), "bl0000000003");
    assert.equal(catalogSortKeyOf("D5"), "d0000000005");
  });

  it("keeps the letters written straight after the number as its suffix", () => {
    assert.equal(catalogSortKeyOf("200a"), "0000000200a");
    assert.equal(catalogSortKeyOf("7cII"), "0000000007cii");
    assert.equal(catalogSortKeyOf("200 MNH"), "0000000200");
  });

  it("is null when the number carries no digits at all", () => {
    assert.equal(catalogSortKeyOf("IIIA"), null);
    assert.equal(catalogSortKeyOf(""), null);
    assert.equal(catalogSortKeyOf(null), null);
    assert.equal(catalogSortKeyOf(undefined), null);
  });

  it("orders the basic numbering first, then each prefix family in turn", () => {
    const sorted = ["P15", "Bl 10", "200", "P1", "Bl 2", "15", "D5", "B4"]
      .map((n) => ({ n, k: catalogSortKeyOf(n) }))
      .sort((a, b) => compareCatalogSortKeys(a.k, b.k))
      .map((r) => r.n);
    assert.deepEqual(sorted, ["15", "200", "B4", "Bl 2", "Bl 10", "D5", "P1", "P15"]);
  });

  it("orders a number before its suffixed variants", () => {
    const sorted = ["200b", "200", "200a", "201"]
      .map((n) => ({ n, k: catalogSortKeyOf(n) }))
      .sort((a, b) => compareCatalogSortKeys(a.k, b.k))
      .map((r) => r.n);
    assert.deepEqual(sorted, ["200", "200a", "200b", "201"]);
  });
});

describe("computeCatalogSortKey", () => {
  const nums = [
    { catalogVendorId: "mi", value: "200" },
    { catalogVendorId: "sc", value: "45" },
  ];

  it("prefers the primary vendor's number", () => {
    assert.equal(computeCatalogSortKey(nums, "mi"), "0000000200");
    assert.equal(computeCatalogSortKey(nums, "sc"), "0000000045");
  });

  it("falls back to the lowest key when there is no primary match", () => {
    assert.equal(computeCatalogSortKey(nums, "unknown"), "0000000045");
    assert.equal(computeCatalogSortKey(nums, null), "0000000045");
  });

  it("keeps a prefixed primary number rather than falling past it", () => {
    const withPrefixedPrimary = [
      { catalogVendorId: "mi", value: "Bl3" },
      { catalogVendorId: "sc", value: "45" },
    ];
    assert.equal(computeCatalogSortKey(withPrefixedPrimary, "mi"), "bl0000000003");
  });

  it("falls back past a digit-less primary number", () => {
    const withRomanPrimary = [
      { catalogVendorId: "mi", value: "IIIA" },
      { catalogVendorId: "sc", value: "45" },
    ];
    assert.equal(computeCatalogSortKey(withRomanPrimary, "mi"), "0000000045");
  });

  it("is null when no number carries digits", () => {
    assert.equal(computeCatalogSortKey([{ catalogVendorId: "mi", value: "IIIA" }], "mi"), null);
    assert.equal(computeCatalogSortKey([], "mi"), null);
  });
});

describe("compareCatalogSortKeys", () => {
  it("sorts ascending with number-less rows last", () => {
    assert.equal(compareCatalogSortKeys("0000000001", "0000000002"), -1);
    assert.equal(compareCatalogSortKeys("0000000002", "0000000001"), 1);
    assert.equal(compareCatalogSortKeys("0000000001", "0000000001"), 0);
    assert.equal(compareCatalogSortKeys(null, "0000000001"), 1);
    assert.equal(compareCatalogSortKeys("0000000001", null), -1);
    assert.equal(compareCatalogSortKeys(null, null), 0);
  });
});
