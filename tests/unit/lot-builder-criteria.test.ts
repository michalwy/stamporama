import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lotBuilderSearchParams,
  parseLotBuilderRequest,
  suggestLotTexts,
  toLotCriteria,
  type LotBuilderCriteria,
  type LotBuilderRequest,
  type LotTextFacts,
} from "../../src/lib/lot-builder-criteria";

// The bulk-lot wizard's criteria (#759): what the collector typed, its round trip through the query
// string, and the texts derived from it.
//
// The round trip is the load-bearing part. State lives in the URL because the commit re-plans (#717)
// — the query string *is* the proposal — so a parameter written at one end and read loosely at the
// other would plan a different lot from the one on screen.

function criteria(overrides: Partial<LotBuilderCriteria> = {}): LotBuilderCriteria {
  return {
    platformId: "plat-1",
    areaId: null,
    yearFrom: null,
    yearTo: null,
    conditionIds: [],
    formatIds: [],
    maxCatalogValue: null,
    countMin: null,
    countMax: null,
    valueMin: null,
    valueMax: null,
    series: "neutral",
    maxPerStamp: null,
    duplicates: "neutral",
    ...overrides,
  };
}

function request(overrides: Partial<LotBuilderRequest> = {}): LotBuilderRequest {
  return { criteria: criteria(), seed: "", pinnedItemIds: [], rejectedItemIds: [], ...overrides };
}

function roundTrip(input: LotBuilderRequest): LotBuilderRequest {
  return parseLotBuilderRequest(lotBuilderSearchParams(input));
}

describe("the bulk-lot criteria round trip (#759)", () => {
  it("returns a full request unchanged", () => {
    const input = request({
      criteria: criteria({
        areaId: "area-pl",
        yearFrom: 1950,
        yearTo: 1960,
        conditionIds: ["cond-u", "cond-mnh"],
        formatIds: ["single", "fmt-block"],
        maxCatalogValue: 5,
        countMin: 90,
        countMax: 110,
        valueMin: 40,
        valueMax: 80,
        series: "preferComplete",
        maxPerStamp: 3,
        duplicates: "preferDuplicates",
      }),
      seed: "abc123",
      pinnedItemIds: ["item-1", "item-2"],
      rejectedItemIds: ["item-9"],
    });
    assert.deepEqual(roundTrip(input), input);
  });

  it("returns an empty request unchanged", () => {
    const input = request();
    assert.deepEqual(roundTrip(input), input);
  });

  it("writes no parameter for an unset criterion, so one request is one address", () => {
    const params = lotBuilderSearchParams(request());
    assert.equal(params.get("yearFrom"), null);
    assert.equal(params.get("countMin"), null);
    assert.equal(params.get("maxPerStamp"), null);
    assert.equal(params.get("area"), null);
    assert.equal(params.get("seed"), null);
  });

  it("drops an unparseable number rather than refusing it — the panel is answered while it is typed", () => {
    const parsed = parseLotBuilderRequest(
      new URLSearchParams("platform=plat-1&countMin=&countMax=ninety&yearFrom=1950")
    );
    assert.equal(parsed.criteria.countMin, null);
    assert.equal(parsed.criteria.countMax, null);
    assert.equal(parsed.criteria.yearFrom, 1950);
  });

  it("falls back to the neutral preferences on an unknown value", () => {
    const parsed = parseLotBuilderRequest(
      new URLSearchParams("platform=plat-1&series=preferEverything&duplicates=lots")
    );
    assert.equal(parsed.criteria.series, "neutral");
    assert.equal(parsed.criteria.duplicates, "neutral");
  });
});

describe("the pick's own inputs (#758's `LotCriteria`)", () => {
  it("keeps an axis with neither bound null — a range object would read as a target", () => {
    const pure = toLotCriteria(criteria());
    assert.equal(pure.count, null);
    assert.equal(pure.catalogValue, null);
  });

  it("carries a one-sided bound through as a range", () => {
    const pure = toLotCriteria(criteria({ countMax: 110, valueMin: 40 }));
    assert.deepEqual(pure.count, { min: null, max: 110 });
    assert.deepEqual(pure.catalogValue, { min: 40, max: null });
  });
});

// ── The pre-filled texts ────────────────────────────────────────────────────────────────────────

function facts(overrides: Partial<LotTextFacts> = {}): LotTextFacts {
  return {
    areaName: "Poland",
    yearFrom: 1950,
    yearTo: 1960,
    conditionNames: ["Used", "MNH"],
    pieceCount: 103,
    distinctStamps: 87,
    completeSets: 3,
    ...overrides,
  };
}

describe("the suggested lot texts (#759)", () => {
  it("names the lot by what it is of, and by the copies actually picked", () => {
    const { name } = suggestLotTexts(facts());
    assert.equal(name, "Poland 1950–1960, 103 stamps");
  });

  it("states variety and the complete sets, and never the catalogue value", () => {
    const { description } = suggestLotTexts(facts());
    assert.equal(
      description,
      "Bulk lot of 103 stamps from Poland, issued 1950–1960.\n" +
        "87 different stamps, including 3 complete sets.\n" +
        "Conditions: Used, MNH."
    );
  });

  it("says nothing about conditions when the criteria allowed every one", () => {
    const { description } = suggestLotTexts(facts({ conditionNames: [] }));
    assert.equal(description.includes("Conditions:"), false);
  });

  it("drops the complete-sets clause when the lot carries none", () => {
    const { description } = suggestLotTexts(facts({ completeSets: 0 }));
    assert.equal(description.split("\n")[1], "87 different stamps.");
  });

  it("renders every shape of year span", () => {
    assert.equal(suggestLotTexts(facts({ yearTo: 1950 })).name, "Poland 1950, 103 stamps");
    assert.equal(suggestLotTexts(facts({ yearTo: null })).name, "Poland from 1950, 103 stamps");
    assert.equal(suggestLotTexts(facts({ yearFrom: null })).name, "Poland to 1960, 103 stamps");
    assert.equal(suggestLotTexts(facts({ yearFrom: null, yearTo: null })).name, "Poland, 103 stamps");
  });

  it("still names a lot the criteria narrowed by neither area nor year", () => {
    const { name } = suggestLotTexts(facts({ areaName: null, yearFrom: null, yearTo: null }));
    assert.equal(name, "Bulk lot of 103 stamps");
  });

  it("counts one of anything in the singular", () => {
    const { name, description } = suggestLotTexts(
      facts({ pieceCount: 1, distinctStamps: 1, completeSets: 1 })
    );
    assert.equal(name, "Poland 1950–1960, 1 stamp");
    assert.equal(description.split("\n")[1], "1 different stamp, including 1 complete set.");
  });
});
