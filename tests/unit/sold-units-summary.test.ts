import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { soldUnitsSummary } from "../../src/lib/sold-units-summary";

// The Sold units heading's figures (#2231): the sale's sets, copies and packed copies.

const sets = (...counts: number[]) => counts.map((copyCount) => ({ copyCount }));

describe("soldUnitsSummary", () => {
  it("counts the sets, their copies and the packed ones", () => {
    assert.equal(soldUnitsSummary(sets(5, 3, 1), 4), "3 sets · 9 copies · 5 packed");
  });

  it("reads nothing packed as zero", () => {
    assert.equal(soldUnitsSummary(sets(2, 2), 4), "2 sets · 4 copies · 0 packed");
  });

  it("reads every copy packed as all packed", () => {
    assert.equal(soldUnitsSummary(sets(2, 2), 0), "2 sets · 4 copies · all packed");
  });

  it("speaks of one set and one copy in the singular", () => {
    assert.equal(soldUnitsSummary(sets(1), 1), "1 set · 1 copy · 0 packed");
  });

  it("says nothing for a sale with no sold sets", () => {
    assert.equal(soldUnitsSummary([], 0), null);
  });

  it("says nothing about packing when the sets hold no copies", () => {
    assert.equal(soldUnitsSummary(sets(0), 0), "1 set · 0 copies");
  });
});
