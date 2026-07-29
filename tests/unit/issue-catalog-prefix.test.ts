import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData, AreaCatalogEntry } from "../../src/lib/areas";
import {
  buildAreaVendorMaps,
  formatStampCN,
  type IssuePrefixMap,
} from "../../src/lib/area-vendor";

// Per-issue overrides of the area-resolved catalog prefix (#377). The pure half: given the area
// tree and a sparse override map, which `AreaCatalogEntry` does a stamp's number render through?

const MICHEL: AreaCatalogEntry = {
  catalogNameId: "mi-name",
  catalogVendorId: "mi",
  vendorName: "Michel",
  catalogName: "Michel Europa",
  vendorAbbreviation: "Mi",
  prefix: "PL",
};

const FISCHER: AreaCatalogEntry = {
  catalogNameId: "fi-name",
  catalogVendorId: "fi",
  vendorName: "Fischer",
  catalogName: "Fischer",
  vendorAbbreviation: "Fi",
  prefix: "PL",
};

function area(over: Partial<CollectionAreaData> & { id: string; name: string }): CollectionAreaData {
  return {
    parentId: null,
    description: null,
    primaryCatalogNameId: null,
    titleName: null,
    titleNameByLanguage: {},
    assignable: true,
    sortOrder: 0,
    stampCount: 0,
    childCount: 0,
    catalogEntries: [],
    ...over,
  };
}

const AREAS = [area({ id: "pl", name: "Poland", catalogEntries: [MICHEL, FISCHER] })];

function overrides(entries: [string, [string, string][]][]): IssuePrefixMap {
  return new Map(entries.map(([issueId, pairs]) => [issueId, new Map(pairs)]));
}

describe("buildAreaVendorMaps — issue prefix overrides (#377)", () => {
  it("falls back to the area's prefix for an issue with no override", () => {
    const maps = buildAreaVendorMaps(AREAS, overrides([["special", [["mi", "SP"]]]]));
    const vendorMap = maps.vendorMapFor("pl", "ordinary");
    assert.equal(formatStampCN("200", vendorMap.get("mi")), "Mi·PL 200");
  });

  it("substitutes the issue's prefix for the vendor it names", () => {
    const maps = buildAreaVendorMaps(AREAS, overrides([["special", [["mi", "SP"]]]]));
    const vendorMap = maps.vendorMapFor("pl", "special");
    assert.equal(formatStampCN("200", vendorMap.get("mi")), "Mi·SP 200");
  });

  it("leaves the issue's other vendors on the area's prefix", () => {
    const maps = buildAreaVendorMaps(AREAS, overrides([["special", [["mi", "SP"]]]]));
    const vendorMap = maps.vendorMapFor("pl", "special");
    assert.equal(formatStampCN("3", vendorMap.get("fi")), "Fi·PL 3");
  });

  it("overrides each vendor independently", () => {
    const maps = buildAreaVendorMaps(
      AREAS,
      overrides([["special", [["mi", "SP"], ["fi", "XX"]]]])
    );
    const vendorMap = maps.vendorMapFor("pl", "special");
    assert.equal(formatStampCN("200", vendorMap.get("mi")), "Mi·SP 200");
    assert.equal(formatStampCN("3", vendorMap.get("fi")), "Fi·XX 3");
  });

  it("ignores an override for a vendor the area does not carry", () => {
    const maps = buildAreaVendorMaps(AREAS, overrides([["special", [["sn", "US"]]]]));
    const vendorMap = maps.vendorMapFor("pl", "special");
    assert.equal(vendorMap.get("sn"), undefined);
    assert.equal(formatStampCN("200", vendorMap.get("mi")), "Mi·PL 200");
  });

  it("returns the area's own map unchanged when nothing is overridden", () => {
    const maps = buildAreaVendorMaps(AREAS);
    assert.equal(maps.vendorMapFor("pl", "special"), maps.vendorMapByArea.get("pl"));
    assert.equal(maps.vendorMapFor("pl", null), maps.vendorMapByArea.get("pl"));
  });

  it("never mutates the area's own map", () => {
    const maps = buildAreaVendorMaps(AREAS, overrides([["special", [["mi", "SP"]]]]));
    maps.vendorMapFor("pl", "special");
    assert.equal(maps.vendorMapByArea.get("pl")?.get("mi")?.prefix, "PL");
  });

  it("memoizes the override-applied map per (area, issue) pair", () => {
    const maps = buildAreaVendorMaps(AREAS, overrides([["special", [["mi", "SP"]]]]));
    assert.equal(maps.vendorMapFor("pl", "special"), maps.vendorMapFor("pl", "special"));
  });

  it("resolves to an empty map for a stamp with no area", () => {
    const maps = buildAreaVendorMaps(AREAS, overrides([["special", [["mi", "SP"]]]]));
    assert.equal(maps.vendorMapFor(null, "special").size, 0);
  });
});
