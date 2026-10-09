import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerCostEstimateNotes, offerCostTotals, offerSetCost } from "../../src/lib/offer-cost";

// An offer's COST while some copies' lot is still open (#1736): a pending copy counts at its
// estimate and marks the figure, one with no estimate leaves it partial and is named, and a set with
// nothing pending reads exactly as it did before.

describe("an offer set's COST (#1736)", () => {
  it("is the frozen total alone, unmarked, when nothing is pending", () => {
    const cost = offerSetCost({ total: "12.00", count: 2, noneCount: 1 }, []);
    assert.equal(cost.amount, "12.00");
    assert.equal(cost.estimated, false);
    assert.equal(cost.noneCount, 1);
  });

  it("adds each pending copy's estimate and marks the figure", () => {
    const cost = offerSetCost({ total: "1.10", count: 1, noneCount: 0 }, [
      { label: "A", estimate: 0.2 },
      { label: "B", estimate: 4 },
    ]);
    // In cents, so 1.10 + 0.20 is not 1.3000000000000003.
    assert.equal(cost.amount, "5.30");
    assert.equal(cost.estimatedCount, 2);
    assert.deepEqual(cost.unestimated, []);
    assert.equal(cost.estimated, true);
  });

  it("is built from estimates alone when no copy is frozen yet", () => {
    const cost = offerSetCost({ total: "0.00", count: 0, noneCount: 0 }, [{ label: "A", estimate: 8 }]);
    assert.equal(cost.amount, "8.00");
    assert.equal(cost.estimated, true);
  });

  it("leaves a copy with no estimate out, named, and the figure marked", () => {
    const cost = offerSetCost({ total: "3.00", count: 1, noneCount: 0 }, [
      { label: "A", estimate: 2 },
      { label: "B", estimate: null },
    ]);
    assert.equal(cost.amount, "5.00");
    assert.deepEqual(cost.unestimated, ["B"]);
    assert.equal(cost.estimated, true);
  });

  it("states no figure when nothing is known and nothing could be estimated", () => {
    const cost = offerSetCost({ total: "0.00", count: 0, noneCount: 0 }, [{ label: "A", estimate: null }]);
    assert.equal(cost.amount, null);
    assert.deepEqual(cost.unestimated, ["A"]);
  });
});

describe("an offer's COST totals (#1736)", () => {
  it("sums the sets' figures and averages over the sets carrying one", () => {
    const totals = offerCostTotals([
      offerSetCost({ total: "3.00", count: 1, noneCount: 0 }, []),
      offerSetCost({ total: "0.00", count: 0, noneCount: 0 }, [{ label: "A", estimate: 5 }]),
      offerSetCost({ total: "0.00", count: 0, noneCount: 0 }, [{ label: "B", estimate: null }]),
    ]);
    assert.equal(totals.total, 8);
    assert.equal(totals.average, 4);
    assert.equal(totals.countedSets, 2);
    assert.equal(totals.estimatedCount, 1);
    assert.deepEqual(totals.unestimated, ["B"]);
    assert.equal(totals.estimated, true);
  });

  it("is unmarked when no set leans on an open lot", () => {
    const totals = offerCostTotals([offerSetCost({ total: "3.00", count: 1, noneCount: 0 }, [])]);
    assert.equal(totals.estimated, false);
    assert.equal(totals.total, 3);
  });

  it("states nothing over sets with no figure", () => {
    const totals = offerCostTotals([offerSetCost({ total: "0.00", count: 0, noneCount: 1 }, [])]);
    assert.equal(totals.total, null);
    assert.equal(totals.average, null);
    assert.equal(totals.countedSets, 0);
  });
});

describe("the estimated COST's hint (#1736)", () => {
  it("says nothing when nothing is pending", () => {
    assert.deepEqual(offerCostEstimateNotes(0, []), []);
  });

  it("counts the estimated copies and says the figure settles when the lots close", () => {
    const [note] = offerCostEstimateNotes(3, []);
    assert.match(note, /3 copies estimated/);
    assert.match(note, /settles when the lots are closed/);
    assert.match(offerCostEstimateNotes(1, [])[0], /1 copy estimated .* the lot is closed/);
  });

  it("names the copies without a figure, and only the first few of a long list", () => {
    assert.match(offerCostEstimateNotes(0, ["Mi 1", "Mi 2"])[0], /no figure yet for Mi 1, Mi 2 —/);
    const long = offerCostEstimateNotes(0, ["1", "2", "3", "4", "5", "6", "7"])[0];
    assert.match(long, /for 1, 2, 3, 4, 5 and 2 more/);
  });
});
