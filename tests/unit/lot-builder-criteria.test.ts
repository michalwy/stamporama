import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyLotRecipe,
  lotBuilderSearchParams,
  parseLotBuilderRequest,
  toLotRecipe,
  suggestLotTexts,
  toLotCriteria,
  LOT_RECIPE_KEYS,
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
    areaSubtree: true,
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
    nameTemplate: null,
    descriptionTemplate: null,
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

  it("round-trips an area narrowed to itself (#385)", () => {
    const input = request({ criteria: criteria({ areaId: "area-pl", areaSubtree: false }) });
    assert.deepEqual(roundTrip(input), input);
    assert.equal(lotBuilderSearchParams(input).get("areaScope"), "self");
  });

  it("writes no areaScope for the subtree, so a link written before the toggle still means the tree", () => {
    const params = lotBuilderSearchParams(
      request({ criteria: criteria({ areaId: "area-pl", areaSubtree: true }) })
    );
    assert.equal(params.get("areaScope"), null);
    assert.equal(
      parseLotBuilderRequest(new URLSearchParams("platform=plat-1&area=area-pl")).criteria
        .areaSubtree,
      true
    );
  });

  it("reads only the exact word as narrowing — anything else is the tree", () => {
    const parsed = parseLotBuilderRequest(
      new URLSearchParams("platform=plat-1&area=area-pl&areaScope=only")
    );
    assert.equal(parsed.criteria.areaSubtree, true);
  });

  it("round-trips the listing wording, and reads a blank one as absent (#774)", () => {
    const input = request({
      criteria: criteria({
        nameTemplate: "{area} {year}, {count} stamps",
        descriptionTemplate: "Bulk lot of {count} stamps.\nConditions: {condition}.",
      }),
    });
    assert.deepEqual(roundTrip(input), input);
    // Blank and absent are one thing — "leave the platform's template" — and an empty parameter must
    // not come back as an empty *override*, which would render an empty listing.
    const blank = parseLotBuilderRequest(new URLSearchParams("platform=plat-1&nameTpl=&descTpl="));
    assert.equal(blank.criteria.nameTemplate, null);
    assert.equal(blank.criteria.descriptionTemplate, null);
  });

  it("keeps the wording out of the pick's own inputs", () => {
    const pure = toLotCriteria(criteria({ nameTemplate: "{count} stamps" }));
    assert.equal("nameTemplate" in pure, false);
  });

  it("falls back to the neutral preferences on an unknown value", () => {
    const parsed = parseLotBuilderRequest(
      new URLSearchParams("platform=plat-1&series=preferEverything&duplicates=lots")
    );
    assert.equal(parsed.criteria.series, "neutral");
    assert.equal(parsed.criteria.duplicates, "neutral");
  });
});

describe("the preset's recipe (#773)", () => {
  const FULL = criteria({
    platformId: "plat-1",
    areaId: "area-pl",
    areaSubtree: false,
    yearFrom: 1950,
    yearTo: 1960,
    conditionIds: ["cond-u"],
    formatIds: ["single"],
    maxCatalogValue: 5,
    countMin: 90,
    countMax: 110,
    valueMin: 40,
    valueMax: 80,
    series: "preferComplete",
    maxPerStamp: 3,
    duplicates: "preferDuplicates",
  });

  it("keeps every recipe key and nothing else", () => {
    const recipe = toLotRecipe(FULL);
    assert.deepEqual(Object.keys(recipe).sort(), [...LOT_RECIPE_KEYS].sort());
  });

  // The whole reason the platform and the area are out of the recipe: one recipe is meant to be run
  // over Germany and then over Poland, on whichever platform the sitting is about.
  it("leaves the platform, the area and its subtree scope exactly as they stand", () => {
    const applied = applyLotRecipe(FULL, toLotRecipe(criteria({ countMin: 5 })));
    assert.equal(applied.platformId, "plat-1");
    assert.equal(applied.areaId, "area-pl");
    assert.equal(applied.areaSubtree, false);
  });

  it("applies whole rather than merging, so a preset means the same thing whatever was on screen", () => {
    const recipe = toLotRecipe(criteria({ countMin: 5 }));
    const applied = applyLotRecipe(FULL, recipe);
    assert.equal(applied.countMin, 5);
    // Left lying about from the last lot, and said nothing about by this preset.
    assert.equal(applied.yearFrom, null);
    assert.equal(applied.maxCatalogValue, null);
    assert.deepEqual(applied.conditionIds, []);
    assert.equal(applied.series, "neutral");
  });

  it("round-trips the criteria through a recipe and back", () => {
    const applied = applyLotRecipe(criteria(), toLotRecipe(FULL));
    assert.deepEqual(toLotRecipe(applied), toLotRecipe(FULL));
  });

  it("copies the lists rather than sharing them", () => {
    const recipe = toLotRecipe(FULL);
    recipe.conditionIds.push("cond-mnh");
    assert.deepEqual(FULL.conditionIds, ["cond-u"]);
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
    ...overrides,
  };
}

// The suggestion is a **template** (#774), not finished text. What may appear in it is exactly what
// the engine can still answer later — `{area}`, `{year}`, `{count}`, `{condition}` — because the
// offer re-renders it whenever its composition changes. The variety and the complete-set tally are
// out for the same reason: both mean a rollup this engine knows nothing about, so as numbers they
// would go stale the first time a copy left the lot.
describe("the suggested lot templates (#759, #774)", () => {
  it("names the lot by what it is of, and counts the copies with a token", () => {
    assert.equal(suggestLotTexts(facts()).name, "{area} {year}, {count} stamps");
  });

  it("states the conditions the lot has, not the ones the criteria allowed", () => {
    assert.equal(
      suggestLotTexts(facts()).description,
      "Bulk lot of {count} stamps from {area}, issued {year}.\nConditions: {condition}."
    );
  });

  it("says nothing about conditions when the criteria allowed every one", () => {
    assert.equal(suggestLotTexts(facts({ conditionNames: [] })).description.includes("Conditions:"), false);
  });

  // No figure that cannot move is written into the default — that is the whole change. The catalogue
  // value was already refused (#405); the variety and the set tally join it.
  it("bakes in no figure of its own", () => {
    const { name, description } = suggestLotTexts(facts());
    assert.match(name, /\{count\}/);
    assert.equal(/\d/.test(name), false, "no literal number in the title");
    assert.equal(/\d/.test(description), false, "nor in the description");
  });

  it("mentions an axis only when the criteria named one", () => {
    assert.equal(suggestLotTexts(facts({ yearFrom: null, yearTo: null })).name, "{area}, {count} stamps");
    assert.equal(
      suggestLotTexts(facts({ areaName: null, yearFrom: null, yearTo: null })).name,
      "Bulk lot of {count} stamps"
    );
    assert.equal(suggestLotTexts(facts({ areaName: null })).name, "{year}, {count} stamps");
  });
});
