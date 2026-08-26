import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildOfferGroups,
  groupKeyId,
  offerGroupKey,
  offerMatchesFilters,
  offerYearFacets,
  type OfferAreaYear,
} from "../../src/lib/listing-groups";

/** An offer as the grouping sees it: the distinct (area, year) pairs across its copies. */
const offer = (...areaYears: [string | null, number | null][]) => ({
  areaYears: areaYears.map(([areaId, year]): OfferAreaYear => ({ areaId, year })),
});

describe("offerGroupKey", () => {
  it("files an offer whose copies agree under that area and year", () => {
    assert.deepEqual(offerGroupKey(offer(["pl", 1960])), {
      mixed: false,
      areaId: "pl",
      year: 1960,
    });
  });

  it("keeps a repeated identical pair out of Mixed", () => {
    // The read model reports distinct pairs, but an offer of two copies of the same stamp must
    // never be treated as spanning anything.
    assert.equal(offerGroupKey(offer(["pl", 1960], ["pl", 1960])).mixed, false);
  });

  it("calls an offer spanning years Mixed even inside one area", () => {
    assert.equal(offerGroupKey(offer(["pl", 1960], ["pl", 1961])).mixed, true);
  });

  it("calls an offer spanning areas Mixed even on one year", () => {
    assert.equal(offerGroupKey(offer(["pl", 1960], ["de", 1960])).mixed, true);
  });

  it("files copies with no year under the no-year bucket rather than Mixed", () => {
    assert.deepEqual(offerGroupKey(offer(["pl", null], ["pl", null])), {
      mixed: false,
      areaId: "pl",
      year: null,
    });
  });

  it("treats an offer holding nothing as Mixed", () => {
    assert.equal(offerGroupKey(offer()).mixed, true);
  });
});

describe("groupKeyId", () => {
  it("gives Mixed one identity regardless of what made it mixed", () => {
    assert.equal(groupKeyId(offerGroupKey(offer(["pl", 1960], ["de", 1972]))), "mixed");
    assert.equal(groupKeyId(offerGroupKey(offer())), "mixed");
  });

  it("distinguishes the no-area and no-year buckets from a real pair", () => {
    assert.equal(groupKeyId({ mixed: false, areaId: "pl", year: 1960 }), "pl:1960");
    assert.equal(groupKeyId({ mixed: false, areaId: null, year: null }), "no-area:no-year");
  });
});

describe("offerMatchesFilters", () => {
  it("matches an area only when every copy is inside it", () => {
    const areaIds = ["pl", "pl-1960s"];
    assert.equal(offerMatchesFilters(offer(["pl-1960s", 1960]), { areaIds }), true);
    assert.equal(offerMatchesFilters(offer(["pl", 1960], ["pl-1960s", 1961]), { areaIds }), true);
    assert.equal(offerMatchesFilters(offer(["pl", 1960], ["de", 1960]), { areaIds }), false);
  });

  it("shows a year-spanning offer under its area even though it is grouped as Mixed", () => {
    const spanning = offer(["pl", 1960], ["pl", 1961]);
    assert.equal(offerGroupKey(spanning).mixed, true);
    assert.equal(offerMatchesFilters(spanning, { areaIds: ["pl"] }), true);
  });

  it("matches a year only when every copy is on it", () => {
    assert.equal(offerMatchesFilters(offer(["pl", 1960], ["de", 1960]), { year: 1960 }), true);
    assert.equal(offerMatchesFilters(offer(["pl", 1960], ["pl", 1961]), { year: 1960 }), false);
  });

  it("selects the no-year bucket with \"none\"", () => {
    assert.equal(offerMatchesFilters(offer(["pl", null]), { year: "none" }), true);
    assert.equal(offerMatchesFilters(offer(["pl", 1960]), { year: "none" }), false);
  });

  it("never matches an empty offer against a coordinate", () => {
    assert.equal(offerMatchesFilters(offer(), { areaIds: ["pl"] }), false);
    assert.equal(offerMatchesFilters(offer(), { year: 1960 }), false);
  });

  it("passes everything through when nothing is selected", () => {
    assert.equal(offerMatchesFilters(offer(), {}), true);
    assert.equal(offerMatchesFilters(offer(["pl", 1960]), { areaIds: [], year: null }), true);
  });

  it("answers a Mixed selection from the group alone, ignoring area and year", () => {
    const mixed = offer(["pl", 1960], ["de", 1972]);
    assert.equal(offerMatchesFilters(mixed, { mixedOnly: true, areaIds: ["fr"] }), true);
    assert.equal(offerMatchesFilters(offer(["pl", 1960]), { mixedOnly: true }), false);
  });
});

describe("buildOfferGroups", () => {
  it("orders groups down the area tree, then by year, with Mixed last", () => {
    const rows = [
      { id: "d", ...offer(["de", 1972]) },
      { id: "c", ...offer(["pl", null]) },
      { id: "m", ...offer(["pl", 1960], ["de", 1972]) },
      { id: "b", ...offer(["pl", 1961]) },
      { id: "a", ...offer(["pl", 1960]) },
    ];

    const groups = buildOfferGroups(rows, ["pl", "de"]);

    assert.deepEqual(
      groups.map((g) => g.id),
      ["pl:1960", "pl:1961", "pl:no-year", "de:1972", "mixed"]
    );
    assert.deepEqual(groups[0].offers.map((o) => o.id), ["a"]);
    assert.deepEqual(groups[4].offers.map((o) => o.id), ["m"]);
  });

  it("collects every offer of a group under one header", () => {
    const rows = [
      { id: "a", ...offer(["pl", 1960]) },
      { id: "b", ...offer(["pl", 1960]) },
    ];
    const groups = buildOfferGroups(rows, ["pl"]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].offers.map((o) => o.id), ["a", "b"]);
  });

  it("sorts an area the tree does not know after the ones it does", () => {
    const rows = [{ id: "x", ...offer(["ghost", 1960]) }, { id: "a", ...offer(["pl", 1960]) }];
    assert.deepEqual(
      buildOfferGroups(rows, ["pl"]).map((g) => g.id),
      ["pl:1960", "ghost:1960"]
    );
  });
});

describe("offerYearFacets", () => {
  it("counts years ascending with no-year last, ignoring Mixed offers", () => {
    const rows = [
      offer(["pl", 1960]),
      offer(["pl", 1960]),
      offer(["pl", 1961]),
      offer(["pl", null]),
      offer(["pl", 1960], ["de", 1972]),
    ];

    assert.deepEqual(offerYearFacets(rows), [
      { year: 1960, count: 2 },
      { year: 1961, count: 1 },
      { year: null, count: 1 },
    ]);
  });

  it("respects the area selection but not its own dimension", () => {
    const rows = [offer(["pl", 1960]), offer(["de", 1972])];
    assert.deepEqual(offerYearFacets(rows, { areaIds: ["pl"] }), [{ year: 1960, count: 1 }]);
  });

  it("promises no more than clicking the year delivers", () => {
    // Two copies on different years: no year facet may claim this offer, because selecting either
    // year would filter it out.
    assert.deepEqual(offerYearFacets([offer(["pl", 1960], ["pl", 1961])]), []);
  });
});
