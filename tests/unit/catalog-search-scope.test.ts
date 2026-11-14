import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  catalogKeysInScope,
  catalogNumberTest,
  catalogScopeFromUnticked,
  catalogScopeLabel,
  catalogVendorSearched,
  catalogVendorWhere,
  parseCatalogScope,
  parseUntickedCatalogs,
  writeCatalogScope,
  writeUntickedCatalogs,
} from "../../src/lib/catalog-search-scope";
import { writeAttachQuery, readAttachQuery, DEFAULT_ATTACH_FILTERS } from "../../src/lib/attach-picker-filters";
import { copiesListQueryParams } from "../../src/lib/copies-list-url";

// #2529: a catalogue-number search looks only in the catalogues ticked beside it — one remembered
// choice per collection, every catalogue by default, a typed vendor prefix still winning.

const VENDORS = [
  { id: "mi", name: "Michel", abbreviation: "Mi" },
  { id: "fi", name: "Fischer", abbreviation: "Fi" },
  { id: "sc", name: "Scott", abbreviation: "Sc" },
  { id: "s", name: "Stanley Gibbons", abbreviation: "S" },
];
const IDS = VENDORS.map((v) => v.id);

describe("the remembered choice", () => {
  it("is every catalogue while nothing is unticked", () => {
    assert.equal(catalogScopeFromUnticked([], IDS), undefined);
    assert.equal(catalogScopeFromUnticked(parseUntickedCatalogs(null), IDS), undefined);
  });

  it("remembers the unticked catalogues, so one taken up later starts ticked", () => {
    const stored = writeUntickedCatalogs(["mi", "fi"], IDS);
    assert.equal(stored, "sc,s");
    assert.deepEqual(catalogScopeFromUnticked(parseUntickedCatalogs(stored), IDS), ["mi", "fi"]);
    assert.deepEqual(catalogScopeFromUnticked(parseUntickedCatalogs(stored), [...IDS, "yt"]), [
      "mi",
      "fi",
      "yt",
    ]);
  });

  it("stores nothing for every catalogue ticked", () => {
    assert.equal(writeUntickedCatalogs(IDS, IDS), "");
  });

  it("never narrows to nothing — a memory that would leave none reads as every catalogue", () => {
    assert.equal(catalogScopeFromUnticked(IDS, IDS), undefined);
    assert.equal(catalogScopeFromUnticked(["gone"], IDS), undefined);
  });
});

describe("the wire", () => {
  it("sends the ticked catalogues, and nothing while every one is ticked", () => {
    assert.equal(writeCatalogScope(undefined), undefined);
    assert.equal(writeCatalogScope(["mi", "fi"]), "mi,fi");
    assert.deepEqual(parseCatalogScope("mi,fi"), ["mi", "fi"]);
    assert.equal(parseCatalogScope(""), undefined);
    assert.equal(parseCatalogScope(null), undefined);
  });
});

describe("catalogVendorWhere", () => {
  it("is no clause for every catalogue", () => {
    assert.deepEqual(catalogVendorWhere(null, undefined), {});
  });

  it("narrows a bare number to the ticked catalogues", () => {
    assert.deepEqual(catalogVendorWhere(null, ["mi", "fi"]), { catalogVendorId: { in: ["mi", "fi"] } });
  });

  it("lets a typed prefix win over the ticks — Sc 200 with Scott unticked", () => {
    assert.deepEqual(catalogVendorWhere("sc", ["mi", "fi"]), { catalogVendorId: "sc" });
    assert.equal(catalogVendorSearched("sc", "sc", ["mi", "fi"]), true);
    assert.equal(catalogVendorSearched("mi", "sc", ["mi", "fi"]), false);
  });

  it("searches only the ticked catalogues without a prefix", () => {
    assert.equal(catalogVendorSearched("mi", null, ["mi", "fi"]), true);
    assert.equal(catalogVendorSearched("sc", null, ["mi", "fi"]), false);
    assert.equal(catalogVendorSearched("sc", null, undefined), true);
  });
});

describe("a picker's own search", () => {
  it("reads a typed prefix off the query", () => {
    const test = catalogNumberTest("Sc 200", VENDORS, ["mi", "fi"]);
    assert.equal(test("sc"), true);
    assert.equal(test("mi"), false);
    const bare = catalogNumberTest("200", VENDORS, ["mi", "fi"]);
    assert.equal(bare("mi"), true);
    assert.equal(bare("sc"), false);
  });

  it("narrows printed keys by their leading abbreviation, longest first", () => {
    const keys = ["mipl200", "fi200", "sc200", "s200"];
    assert.deepEqual(catalogKeysInScope(keys, "200", VENDORS, ["mi", "fi"]), ["mipl200", "fi200"]);
    // `Sc` is never taken for `S`.
    assert.deepEqual(catalogKeysInScope(keys, "200", VENDORS, ["s"]), ["s200"]);
    assert.deepEqual(catalogKeysInScope(keys, "Sc 200", VENDORS, ["mi"]), ["sc200"]);
    assert.equal(catalogKeysInScope(keys, "200", VENDORS, undefined), keys);
  });
});

describe("catalogScopeLabel", () => {
  it("names every catalogue, or the ticked abbreviations", () => {
    assert.equal(catalogScopeLabel(undefined, VENDORS), "All catalogues");
    assert.equal(catalogScopeLabel(["mi", "fi"], VENDORS), "Mi, Fi");
  });
});

describe("the scope on a picker's or a screen's query string", () => {
  it("rides with the attach picker's search, and only with it", () => {
    const params = new URLSearchParams();
    writeAttachQuery(params, DEFAULT_ATTACH_FILTERS, null, "200", true, ["mi"]);
    assert.deepEqual(readAttachQuery(params, "200").catalogScope, ["mi"]);
    const none = new URLSearchParams();
    writeAttachQuery(none, DEFAULT_ATTACH_FILTERS, null, "", true, ["mi"]);
    assert.equal(readAttachQuery(none, undefined).catalogScope, undefined);
  });

  it("rides with the Copies address's search on the structure screen", () => {
    const ctx = { areas: [], includeSubAreas: true, includeSubLocations: true, catalogVendors: VENDORS };
    const url = new URLSearchParams({ search: "200" });
    assert.equal(copiesListQueryParams(url, { ...ctx, catalogScope: ["mi"] }).get("catalogScope"), "mi");
    assert.equal(copiesListQueryParams(url, ctx).get("catalogScope"), null);
  });
});
