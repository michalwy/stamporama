import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AreaCatalogEntry, AreaVendorEntry, CollectionAreaData } from "../../src/lib/areas";
import { effectiveVendorsForArea, resolveAreaVendorPrefix } from "../../src/lib/area-vendor";
import {
  FISCHER,
  MICHEL,
  PREFIX_CASES,
  SCOTT,
  prefixAreasAsClientData,
} from "../fixtures/area-prefix-cases";

// The client half of the two-level area prefix (#675). The cases live in the fixture beside the
// rule they state; `tests/integration/area-prefix-resolution.test.ts` runs the very same ones
// through the server resolver and asserts the two agree, which is the property that matters — the
// prefix is catalog *identity*, so a label and a duplicate check that disagree is the bug.

const AREAS = prefixAreasAsClientData();

describe("resolveAreaVendorPrefix (#675)", () => {
  for (const { areaId, vendorId, expected, joined = false } of PREFIX_CASES) {
    it(`resolves (${areaId}, ${vendorId}) to ${expected === null ? "no prefix" : expected}${joined ? ", joined" : ""}`, () => {
      const resolved = resolveAreaVendorPrefix(AREAS, areaId, vendorId);
      assert.equal(resolved?.prefix ?? null, expected);
      assert.equal(resolved?.joined ?? false, joined);
    });
  }
});

describe("effectiveVendorsForArea (#675)", () => {
  it("carries the resolved prefix, not the declaring area's raw row", () => {
    const byVendor = new Map(
      effectiveVendorsForArea(AREAS, "gg").map((e) => [e.catalogVendorId, e])
    );
    assert.equal(byVendor.get(MICHEL)?.prefix, "GG");
    assert.equal(byVendor.get(FISCHER)?.prefix, "GG");
  });

  it("carries the resolved prefix's joining with it (#2657)", () => {
    const byVendor = new Map(
      effectiveVendorsForArea(AREAS, "drc").map((e) => [e.catalogVendorId, e])
    );
    assert.equal(byVendor.get(SCOTT)?.prefix, "GER O");
    assert.equal(byVendor.get(SCOTT)?.prefixJoined, false);
    const own = effectiveVendorsForArea(AREAS, "tp").find((e) => e.catalogVendorId === MICHEL);
    assert.equal(own?.prefix, "PL TP W");
    assert.equal(own?.prefixJoined, true);
  });

  it("includes a vendor declared with no book of its own", () => {
    const scott = effectiveVendorsForArea(AREAS, "sl").find((e) => e.catalogVendorId === SCOTT);
    assert.ok(scott);
    assert.equal(scott.catalogNameId, null);
    assert.equal(scott.prefix, "POL");
  });

  it("does not let a bookless vendor row erase a book an ancestor supplied", () => {
    const book: AreaCatalogEntry = {
      catalogVendorId: MICHEL,
      vendorName: "Michel",
      vendorAbbreviation: "Mi",
      prefix: null,
      prefixJoined: false,
      catalogNameId: "mi-book",
      catalogName: "Michel Deutschland",
    };
    const row: AreaVendorEntry = {
      catalogVendorId: MICHEL,
      vendorName: "Michel",
      vendorAbbreviation: "Mi",
      areaPrefix: "X",
      prefixJoined: false,
    };
    const base: Omit<CollectionAreaData, "id" | "parentId" | "catalogEntries" | "vendorEntries"> = {
      name: "Area",
      description: null,
      primaryCatalogNameId: null,
      primaryCatalogVendorId: null,
      catalogPrefix: null,
      catalogPrefixJoined: false,
      anchorMarkets: [],
      titleName: null,
      titleNameByLanguage: {},
      symbol: null,
      coverSymbols: null,
      stillValidForPostage: null,
      valuationMethod: null,
      assignable: true,
      sortOrder: 0,
      stampCount: 0,
      childCount: 0,
    };
    const areas: CollectionAreaData[] = [
      { ...base, id: "root", parentId: null, catalogEntries: [book], vendorEntries: [] },
      { ...base, id: "leaf", parentId: "root", catalogEntries: [], vendorEntries: [row] },
    ];
    const michel = effectiveVendorsForArea(areas, "leaf").find((e) => e.catalogVendorId === MICHEL);
    assert.equal(michel?.catalogNameId, "mi-book");
    assert.equal(michel?.prefix, "X");
  });
});
