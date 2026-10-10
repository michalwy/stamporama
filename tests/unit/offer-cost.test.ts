import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  copiesCost,
  copyCostFigure,
  offerCostEstimateNotes,
  offerCostTotals,
  offerSetCost,
  type CopyCostInput,
} from "../../src/lib/offer-cost";

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

// The Lot builder's proposed lot (#1743), costed from its copies' own fields by the same rule.
describe("a proposed lot's cost (#1743)", () => {
  const copy = (over: Partial<CopyCostInput>): CopyCostInput => ({
    costBasis: null,
    lotId: null,
    lotStatus: null,
    lotValued: null,
    openingBalance: false,
    costEstimate: null,
    label: "#1",
    ...over,
  });
  const frozen = (amount: string) => copy({ costBasis: amount, lotId: "L1", lotStatus: "closed", lotValued: true });
  const open = (label: string, estimate: string | null) =>
    copy({ lotId: "L2", lotStatus: "open", lotValued: true, costEstimate: estimate, label });

  it("sums frozen cost bases, unmarked, when nothing is pending", () => {
    const cost = copiesCost([frozen("1.10"), frozen("0.20"), copy({})]);
    assert.equal(cost.amount, "1.30");
    assert.equal(cost.knownCount, 2);
    assert.equal(cost.noneCount, 1);
    assert.equal(cost.estimated, false);
  });

  it("counts an open lot's copy at its estimate and marks the figure", () => {
    const cost = copiesCost([frozen("2.00"), open("#2", "0.75")]);
    assert.equal(cost.amount, "2.75");
    assert.equal(cost.estimatedCount, 1);
    assert.equal(cost.estimated, true);
  });

  it("leaves a pending copy with no estimate out, named, and the figure marked as partial", () => {
    const cost = copiesCost([frozen("2.00"), open("#3 (Eagle)", null)]);
    assert.equal(cost.amount, "2.00");
    assert.deepEqual(cost.unestimated, ["#3 (Eagle)"]);
    assert.equal(cost.estimated, true);
  });

  it("leaves an opening balance's copy out, as an offer's COST does", () => {
    const cost = copiesCost([
      frozen("1.00"),
      copy({ costBasis: "9.00", lotId: "L3", lotStatus: "closed", lotValued: true, openingBalance: true }),
    ]);
    assert.equal(cost.amount, "1.00");
    assert.equal(cost.knownCount, 1);
    assert.equal(cost.noneCount, 0);
  });

  it("has no figure when no copy carries one", () => {
    const cost = copiesCost([copy({}), open("#4", null)]);
    assert.equal(cost.amount, null);
    assert.equal(cost.estimated, true);
  });

  // Each row of the proposal shows its copy's figure (#1746); the summary is their sum.
  it("states each copy's own figure, the one the summary adds up", () => {
    const opening = copy({ costBasis: "9.00", lotId: "L3", lotStatus: "closed", lotValued: true, openingBalance: true });
    const noValue = copy({ lotId: "L4", lotStatus: "open", lotValued: false });
    assert.deepEqual(copyCostFigure(frozen("1.10")), { kind: "known", amount: "1.10" });
    assert.deepEqual(copyCostFigure(open("#2", "0.75")), { kind: "estimate", amount: "0.75" });
    assert.deepEqual(copyCostFigure(open("#3", null)), { kind: "missing", why: "pending" });
    assert.deepEqual(copyCostFigure(copy({})), { kind: "missing", why: "unrecorded" });
    assert.deepEqual(copyCostFigure(noValue), { kind: "missing", why: "no_opening_value" });
    assert.deepEqual(copyCostFigure(opening), { kind: "missing", why: "opening_balance" });

    const copies = [frozen("1.10"), open("#2", "0.75"), open("#3", null), copy({}), noValue, opening];
    const rows = copies
      .map(copyCostFigure)
      .reduce((sum, f) => (f.kind === "missing" ? sum : sum + Math.round(Number(f.amount) * 100)), 0);
    const cost = copiesCost(copies);
    assert.equal(cost.amount, (rows / 100).toFixed(2));
    assert.equal(cost.amount, "1.85");
    assert.equal(cost.noneCount, 2);
    assert.deepEqual(cost.unestimated, ["#3"]);
  });
});
