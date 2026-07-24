import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCatalogSortInt, computeCatalogSortKey } from "../../src/lib/catalog-sort-key";

describe("parseCatalogSortInt", () => {
  it("reads leading digits", () => {
    assert.equal(parseCatalogSortInt("200"), 200);
    assert.equal(parseCatalogSortInt("200a"), 200);
    assert.equal(parseCatalogSortInt("  17"), 17);
  });
  it("returns null when it does not start with a digit", () => {
    assert.equal(parseCatalogSortInt("B12"), null);
    assert.equal(parseCatalogSortInt("abc"), null);
    assert.equal(parseCatalogSortInt(""), null);
    assert.equal(parseCatalogSortInt(null), null);
    assert.equal(parseCatalogSortInt(undefined), null);
  });
});

describe("computeCatalogSortKey", () => {
  const nums = [
    { catalogVendorId: "mi", value: "200" },
    { catalogVendorId: "sc", value: "45" },
  ];

  it("prefers the primary vendor's number", () => {
    assert.equal(computeCatalogSortKey(nums, "mi"), 200);
    assert.equal(computeCatalogSortKey(nums, "sc"), 45);
  });

  it("falls back to the lowest numeric when there is no primary match", () => {
    assert.equal(computeCatalogSortKey(nums, "unknown"), 45);
    assert.equal(computeCatalogSortKey(nums, null), 45);
  });

  it("falls back past a non-numeric primary number", () => {
    const withLetterPrimary = [
      { catalogVendorId: "mi", value: "Bl3" },
      { catalogVendorId: "sc", value: "45" },
    ];
    assert.equal(computeCatalogSortKey(withLetterPrimary, "mi"), 45);
  });

  it("is null when no number is numeric", () => {
    assert.equal(computeCatalogSortKey([{ catalogVendorId: "mi", value: "Bl3" }], "mi"), null);
    assert.equal(computeCatalogSortKey([], "mi"), null);
  });
});
