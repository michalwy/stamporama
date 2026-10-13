import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData } from "../../src/lib/areas";
import {
  coverSymbolAreaIds,
  resolveEffectiveCatalogPrefix,
  resolveEffectiveCoverSymbols,
  resolveEffectivePrimaryCatalogNameId,
  resolveInheritedAreaValues,
} from "../../src/lib/area-inheritance";

// What a new area inherits from the parent it is created under (#776). The quick-add in the area
// filter facet and the areas management screen resolve this the same way, through this module — and
// since #954 the area form resolves it itself, off whichever parent its picker currently holds, so
// every change of parent in the dialog is another call here.

function area(
  id: string,
  parentId: string | null,
  extra: Partial<CollectionAreaData> = {}
): CollectionAreaData {
  return {
    id,
    name: id,
    parentId,
    description: null,
    primaryCatalogNameId: null,
    primaryCatalogVendorId: null,
    catalogPrefix: null,
    anchorMarkets: [],
    titleName: null,
    titleNameByLanguage: {},
    symbol: null,
    coverSymbols: null,
    assignable: true,
    sortOrder: 0,
    stampCount: 0,
    childCount: 0,
    catalogEntries: [],
    vendorEntries: [],
    ...extra,
  };
}

/** Poland declares everything; GG under it declares only its own prefix; Cities under GG nothing. */
const AREAS: CollectionAreaData[] = [
  area("poland", null, {
    primaryCatalogNameId: "mi-poland",
    primaryCatalogVendorId: "michel",
    catalogPrefix: "PL",
    catalogEntries: [
      {
        catalogVendorId: "michel",
        vendorName: "Michel",
        vendorAbbreviation: "Mi",
        prefix: "PL",
        catalogNameId: "mi-poland",
        catalogName: "Poland",
      },
    ],
  }),
  area("gg", "poland", { catalogPrefix: "GG" }),
  area("cities", "gg"),
];

describe("resolveEffectiveCatalogPrefix", () => {
  it("takes the nearest ancestor-or-self that states one", () => {
    assert.equal(resolveEffectiveCatalogPrefix(AREAS, "cities"), "GG");
    assert.equal(resolveEffectiveCatalogPrefix(AREAS, "gg"), "GG");
    assert.equal(resolveEffectiveCatalogPrefix(AREAS, "poland"), "PL");
  });

  it("reads a blank string as a stated 'no prefix', stopping the walk", () => {
    const areas = [...AREAS.slice(0, 2), area("cities", "gg", { catalogPrefix: "" })];
    assert.equal(resolveEffectiveCatalogPrefix(areas, "cities"), null);
  });
});

describe("resolveEffectivePrimaryCatalogNameId", () => {
  it("rolls the valuing volume down the chain", () => {
    assert.equal(resolveEffectivePrimaryCatalogNameId(AREAS, "cities"), "mi-poland");
  });
});

describe("resolveInheritedAreaValues", () => {
  it("resolves the whole set off the chosen parent", () => {
    const inherited = resolveInheritedAreaValues(AREAS, "gg");
    assert.equal(inherited.inheritedPrimaryId, "mi-poland");
    assert.equal(inherited.inheritedPrimaryVendorId, "michel");
    assert.equal(inherited.inheritedCatalogPrefix, "GG");
    assert.deepEqual(
      inherited.inheritedPrefixes.map((p) => [p.catalogVendorId, p.prefix]),
      [["michel", "GG"]]
    );
  });

  // A top-level area inherits nothing, and the dialog says so — it is where the form tells the
  // collector a valuing volume is required. That prompt is only right when nothing rolls down, so
  // "no parent" must not quietly borrow the first area's chain.
  it("inherits nothing for a top-level area", () => {
    for (const parentId of [null, undefined, ""]) {
      assert.deepEqual(resolveInheritedAreaValues(AREAS, parentId), {
        inheritedPrimaryId: null,
        inheritedPrimaryVendorId: null,
        inheritedCatalogPrefix: null,
        inheritedPrefixes: [],
        inheritedAnchorMarkets: [],
        inheritedCoverSymbols: false,
      });
    }
  });

  // A parent deleted underneath an open dialog. Nothing special happens — each walk looks the id up
  // and finds nothing — and this pins that, so a future short-circuit cannot start returning the
  // first area's chain for an id that names no area.
  it("treats an unknown parent id as no parent", () => {
    assert.deepEqual(resolveInheritedAreaValues(AREAS, "deleted"), {
      inheritedPrimaryId: null,
      inheritedPrimaryVendorId: null,
      inheritedCatalogPrefix: null,
      inheritedPrefixes: [],
      inheritedAnchorMarkets: [],
      inheritedCoverSymbols: false,
    });
  });
});

// Whether an area's stamps may carry forbidden symbols (#1891): inherited down the tree, any lower
// area may override it either way, and a tree that says nothing is off.
describe("resolveEffectiveCoverSymbols", () => {
  const reich = [
    area("germany", null),
    area("reich", "germany", { coverSymbols: true }),
    area("gg", "reich"),
    area("gg-locals", "gg", { coverSymbols: false }),
    area("gg-locals-town", "gg-locals"),
    area("bizone", "germany"),
  ];

  it("is off where nothing in the chain says anything", () => {
    assert.equal(resolveEffectiveCoverSymbols(reich, "germany"), false);
    assert.equal(resolveEffectiveCoverSymbols(reich, "bizone"), false);
  });

  it("is inherited down the tree from the nearest area that sets it", () => {
    assert.equal(resolveEffectiveCoverSymbols(reich, "reich"), true);
    assert.equal(resolveEffectiveCoverSymbols(reich, "gg"), true);
  });

  it("is overridden off by a lower area, and that passes down in turn", () => {
    assert.equal(resolveEffectiveCoverSymbols(reich, "gg-locals"), false);
    assert.equal(resolveEffectiveCoverSymbols(reich, "gg-locals-town"), false);
  });

  it("is overridden on below an area that set it off", () => {
    const areas = [...reich, area("overprint", "gg-locals-town", { coverSymbols: true })];
    assert.equal(resolveEffectiveCoverSymbols(areas, "overprint"), true);
  });

  it("is off for an id naming no area", () => {
    assert.equal(resolveEffectiveCoverSymbols(reich, "deleted"), false);
  });

  it("lists every area it resolves on for", () => {
    assert.deepEqual([...coverSymbolAreaIds(reich)].sort(), ["gg", "reich"]);
  });

  it("is what Same as parent shows in the area dialog", () => {
    assert.equal(resolveInheritedAreaValues(reich, "gg").inheritedCoverSymbols, true);
    assert.equal(resolveInheritedAreaValues(reich, "gg-locals").inheritedCoverSymbols, false);
  });
});
