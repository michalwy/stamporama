import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ATTACH_FILTERS,
  effectiveAttachStates,
  attachOnPurchase,
  parseAttachFilters,
  parseAttachYear,
  readAttachQuery,
  readAttachStates,
  serializeAttachFilters,
  toggleValue,
  writeAttachQuery,
  type AttachPickerFilters,
} from "../../src/lib/attach-picker-filters";

// The Attach existing copies picker's own filters (#2121): condition, certificate and format with
// their null sentinels, the purchase chips, and the state (#2120) — all of them read by the server,
// which the query string carries them to (#2179).

const withFilters = (over: Partial<AttachPickerFilters>): AttachPickerFilters => ({
  ...DEFAULT_ATTACH_FILTERS,
  ...over,
});

describe("the picker's query string (#2179)", () => {
  it("carries every filter, the year, the search and the sort to the route and back", () => {
    const params = new URLSearchParams();
    writeAttachQuery(
      params,
      withFilters({
        dispositions: ["forSale", "forTrade"],
        conditionIds: ["mint", "used"],
        certificateStatusIds: ["none"],
        formatIds: ["single", "pair"],
        purchase: ["on"],
        sortBy: "value",
        sortDir: "desc",
      }),
      "1950",
      "#809"
    );
    assert.deepEqual(readAttachQuery(params, params.get("search") ?? undefined), {
      dispositions: ["forSale", "forTrade"],
      conditionIds: ["mint", "used"],
      certificateStatusIds: ["none"],
      formatIds: ["single", "pair"],
      purchase: ["on"],
      sortBy: "value",
      sortDir: "desc",
      year: 1950,
      search: "#809",
    });
  });

  it("reads no year, no search and an unknown sort as every year, nothing typed and catalogue order", () => {
    const params = new URLSearchParams();
    writeAttachQuery(params, DEFAULT_ATTACH_FILTERS, null, "  ");
    assert.equal(params.get("year"), null);
    assert.equal(params.get("search"), null);
    params.set("sort", "nonsense");
    const read = readAttachQuery(params, undefined);
    assert.equal(read.year, null);
    assert.equal(read.search, "");
    assert.equal(read.sortBy, "catalogue");
    assert.equal(read.sortDir, "asc");
  });

  it("reads the no-year facet as its own value", () => {
    assert.equal(parseAttachYear("none"), "none");
    assert.equal(parseAttachYear("1950"), 1950);
    assert.equal(parseAttachYear("abc"), null);
    assert.equal(parseAttachYear(null), null);
  });

  it("narrows by purchase only when exactly one chip is lit", () => {
    assert.equal(attachOnPurchase([]), null);
    assert.equal(attachOnPurchase(["none", "on"]), null);
    assert.equal(attachOnPurchase(["on"]), true);
    assert.equal(attachOnPurchase(["none"]), false);
  });
});

describe("the disposition filter (#2180)", () => {
  it("opens on every copy, and drops marks it does not know from the route and from storage", () => {
    assert.deepEqual(DEFAULT_ATTACH_FILTERS.dispositions, []);
    const params = new URLSearchParams("disposition=forSale&disposition=sold&disposition=forSale");
    assert.deepEqual(readAttachQuery(params, undefined).dispositions, ["forSale"]);
    assert.deepEqual(
      parseAttachFilters(JSON.stringify({ dispositions: ["inCollection", "kept"] })).dispositions,
      ["inCollection"]
    );
  });
});

describe("the state filter (#2120)", () => {
  it("opens on the held copies", () => {
    assert.deepEqual(DEFAULT_ATTACH_FILTERS.states, ["held"]);
    assert.deepEqual(parseAttachFilters(null).states, ["held"]);
  });

  it("asks for every state when no chip is lit, in a fixed order otherwise", () => {
    assert.deepEqual(effectiveAttachStates([]), ["held", "gone", "disposed"]);
    assert.deepEqual(effectiveAttachStates(["disposed", "held"]), ["held", "disposed"]);
  });

  it("reads the route's states, dropping unknown ones, and none as held", () => {
    assert.deepEqual(readAttachStates(["gone", "nonsense"]), ["gone"]);
    assert.deepEqual(readAttachStates([]), ["held"]);
    assert.deepEqual(readAttachStates(["nonsense"]), ["held"]);
  });
});

describe("remembered filters (#2121)", () => {
  it("round-trips, keeping an emptied state set as every state", () => {
    const f = withFilters({
      dispositions: ["forTrade"],
      conditionIds: ["a"],
      purchase: ["none"],
      states: [],
    });
    assert.deepEqual(parseAttachFilters(serializeAttachFilters(f)), f);
  });

  it("falls back to the default on anything unreadable", () => {
    assert.deepEqual(parseAttachFilters("{not json"), DEFAULT_ATTACH_FILTERS);
    assert.deepEqual(parseAttachFilters("42"), DEFAULT_ATTACH_FILTERS);
    assert.deepEqual(parseAttachFilters("{}"), DEFAULT_ATTACH_FILTERS);
    assert.deepEqual(
      parseAttachFilters(JSON.stringify({ purchase: ["sideways", "on"], states: ["lost"] })).purchase,
      ["on"]
    );
  });

  it("toggles a chip on and off", () => {
    assert.deepEqual(toggleValue(["held"], "gone"), ["held", "gone"]);
    assert.deepEqual(toggleValue(["held", "gone"], "held"), ["gone"]);
  });
});

describe("a stored state list with nothing recognisable (#2121)", () => {
  it("is the default, not every state", () => {
    assert.deepEqual(parseAttachFilters(JSON.stringify({ states: ["lost"] })).states, ["held"]);
  });
});
