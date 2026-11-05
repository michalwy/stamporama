import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  freeExtraFiltersNarrow,
  freeExtraYearFacets,
  freeExtraYearSelects,
  NO_FREE_EXTRA_FILTERS,
  readFreeExtraFilterQuery,
  writeFreeExtraFilterQuery,
  type FreeExtraFilters,
} from "../../src/lib/free-extra-filters";

// The filters of *Add free extras* (#2423) as the dialog sends them and the route reads them back.

describe("free-extra filters (#2423)", () => {
  const full: FreeExtraFilters = {
    areaIds: ["pl", "pl-gg"],
    year: "1945-1960",
    conditionIds: ["none", "used"],
    certificateStatusIds: ["none"],
    formatIds: ["single", "block"],
    issueFormatIds: ["stamp", "bl"],
  };

  it("reads back what it writes", () => {
    assert.deepEqual(readFreeExtraFilterQuery(writeFreeExtraFilterQuery(full)), full);
    assert.deepEqual(readFreeExtraFilterQuery(writeFreeExtraFilterQuery(NO_FREE_EXTRA_FILTERS)), NO_FREE_EXTRA_FILTERS);
  });

  it("writes nothing for no filter", () => {
    assert.equal(writeFreeExtraFilterQuery(NO_FREE_EXTRA_FILTERS).toString(), "");
    assert.equal(freeExtraFiltersNarrow(NO_FREE_EXTRA_FILTERS), false);
  });

  it("narrows on any one axis", () => {
    for (const patch of [
      { areaIds: ["pl"] },
      { year: "none" },
      { conditionIds: ["used"] },
      { certificateStatusIds: ["none"] },
      { formatIds: ["single"] },
      { issueFormatIds: ["stamp"] },
    ]) {
      assert.equal(freeExtraFiltersNarrow({ ...NO_FREE_EXTRA_FILTERS, ...patch }), true);
    }
  });

  it("reads the year as the rail does: one year, no year, or a span", () => {
    const at = (year: string | null) => ({ ...NO_FREE_EXTRA_FILTERS, year });
    assert.equal(freeExtraYearSelects(at(null), null), true);
    assert.equal(freeExtraYearSelects(at("1955"), 1955), true);
    assert.equal(freeExtraYearSelects(at("1955"), 1956), false);
    assert.equal(freeExtraYearSelects(at("none"), null), true);
    assert.equal(freeExtraYearSelects(at("none"), 1955), false);
    assert.equal(freeExtraYearSelects(at("1950-1955"), 1952), true);
    assert.equal(freeExtraYearSelects(at("1950-1955"), null), false);
  });

  it("counts the year facets oldest first, no year last", () => {
    assert.deepEqual(freeExtraYearFacets([1960, null, 1955, 1960, 1950]), [
      { year: 1950, count: 1 },
      { year: 1955, count: 1 },
      { year: 1960, count: 2 },
      { year: null, count: 1 },
    ]);
  });
});
