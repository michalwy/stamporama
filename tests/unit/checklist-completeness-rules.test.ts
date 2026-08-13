import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeChecklistCompleteness,
  computeForSaleSetCompleteness,
  type CompletenessCount,
  type CompletenessDisposition,
} from "../../src/lib/checklist-completeness-rules";

const MNH = "cond-mnh";
const USED = "cond-used";
const CONDITIONS = [MNH, USED];

function count(
  stampId: string,
  conditionId: string,
  n: number,
  flags: Partial<Pick<CompletenessCount, "inCollection" | "forSale" | "forTrade">> = {}
): CompletenessCount {
  return {
    stampId,
    conditionId,
    count: n,
    inCollection: flags.inCollection ?? false,
    forSale: flags.forSale ?? false,
    forTrade: flags.forTrade ?? false,
  };
}

function cell(
  grid: ReturnType<typeof computeChecklistCompleteness>,
  disposition: CompletenessDisposition,
  conditionId: string | null
) {
  const row = grid.rows.find((r) => r.disposition === disposition && r.conditionId === conditionId);
  assert.ok(row, `no cell for ${disposition} × ${conditionId ?? "any"}`);
  return row;
}

describe("computeChecklistCompleteness", () => {
  it("counts owned members and complete sets across any condition", () => {
    const grid = computeChecklistCompleteness(
      ["a", "b", "c"],
      [
        count("a", MNH, 3, { inCollection: true }),
        count("b", MNH, 2, { inCollection: true }),
        count("c", USED, 1, { inCollection: true }),
      ],
      CONDITIONS
    );
    assert.equal(grid.requiredCount, 3);
    const any = cell(grid, "any", null);
    assert.equal(any.owned, 3);
    // The set is limited by the thinnest member — one copy of `c`.
    assert.equal(any.completeSets, 1);
  });

  it("reports zero complete sets while a required member is missing", () => {
    const grid = computeChecklistCompleteness(
      ["a", "b"],
      [count("a", MNH, 9, { inCollection: true })],
      CONDITIONS
    );
    const any = cell(grid, "any", null);
    assert.equal(any.owned, 1);
    assert.equal(any.completeSets, 0);
  });

  it("narrows by condition", () => {
    const grid = computeChecklistCompleteness(
      ["a", "b"],
      [
        count("a", MNH, 2, { inCollection: true }),
        count("b", MNH, 1, { inCollection: true }),
        count("b", USED, 4, { inCollection: true }),
      ],
      CONDITIONS
    );
    assert.equal(cell(grid, "any", MNH).completeSets, 1);
    assert.equal(cell(grid, "any", MNH).owned, 2);
    // Only `b` is held used, so a complete used set is out of reach.
    assert.equal(cell(grid, "any", USED).owned, 1);
    assert.equal(cell(grid, "any", USED).completeSets, 0);
  });

  it("treats dispositions as overlapping markers, not a partition", () => {
    const grid = computeChecklistCompleteness(
      ["a"],
      [count("a", MNH, 2, { inCollection: true, forSale: true })],
      CONDITIONS
    );
    assert.equal(cell(grid, "any", null).completeSets, 2);
    assert.equal(cell(grid, "in_collection", null).completeSets, 2);
    assert.equal(cell(grid, "for_sale", null).completeSets, 2);
    assert.equal(cell(grid, "for_trade", null).completeSets, 0);
  });

  it("sums a stamp's copies across the condition axis when no condition is fixed", () => {
    const grid = computeChecklistCompleteness(
      ["a"],
      [count("a", MNH, 1, { forTrade: true }), count("a", USED, 2, { forTrade: true })],
      CONDITIONS
    );
    assert.equal(cell(grid, "for_trade", null).completeSets, 3);
    assert.equal(cell(grid, "for_trade", MNH).completeSets, 1);
  });

  it("an empty checklist is never complete", () => {
    const grid = computeChecklistCompleteness([], [], CONDITIONS);
    assert.equal(grid.requiredCount, 0);
    assert.equal(cell(grid, "any", null).owned, 0);
    assert.equal(cell(grid, "any", null).completeSets, 0);
  });

  it("ignores copies of stamps outside the required set", () => {
    const grid = computeChecklistCompleteness(
      ["a"],
      [count("a", MNH, 1, { inCollection: true }), count("z", MNH, 5, { inCollection: true })],
      CONDITIONS
    );
    assert.equal(cell(grid, "in_collection", null).completeSets, 1);
  });
});

describe("computeForSaleSetCompleteness", () => {
  it("names what is missing, in the checklist's own order", () => {
    const r = computeForSaleSetCompleteness(["a", "b", "c", "d"], ["a", "c"], []);
    assert.equal(r.requiredCount, 4);
    assert.equal(r.owned, 2);
    // A bare 2/4 does not say what to look for on the next card; this is the point of the figure.
    assert.deepEqual(r.missingStampIds, ["b", "d"]);
  });

  it("reports a complete set with nothing missing", () => {
    const r = computeForSaleSetCompleteness(["a", "b"], ["a", "b", "z"], ["a"]);
    assert.equal(r.owned, 2);
    assert.deepEqual(r.missingStampIds, []);
  });

  it("counts the lot's contribution as a subset of the stock, never beside it", () => {
    // `fromHere` is what separates a series being built out of this parcel from one assembled
    // months ago — so it is only ever *part* of the leading figure.
    const r = computeForSaleSetCompleteness(["a", "b", "c"], ["a", "b", "c"], ["a", "b"]);
    assert.equal(r.owned, 3);
    assert.equal(r.fromHere, 2);
  });

  it("never counts a lot copy the collection-wide read did not see", () => {
    // The two sets come off one `where` plus a scope clause, so this cannot happen — but a second
    // figure able to exceed the first is unreadable, and the arithmetic is cheaper than the trust.
    const r = computeForSaleSetCompleteness(["a", "b"], ["a"], ["a", "b"]);
    assert.equal(r.owned, 1);
    assert.equal(r.fromHere, 1);
  });

  it("counts stock outside the checklist for nothing", () => {
    const r = computeForSaleSetCompleteness(["a"], ["a", "y", "z"], ["y"]);
    assert.equal(r.owned, 1);
    assert.equal(r.fromHere, 0);
  });

  it("an empty checklist is 0/0 with nothing missing, never complete", () => {
    const r = computeForSaleSetCompleteness([], ["a"], ["a"]);
    assert.equal(r.requiredCount, 0);
    assert.equal(r.owned, 0);
    assert.deepEqual(r.missingStampIds, []);
  });

  it("counts a stamp listed twice on one checklist once", () => {
    const r = computeForSaleSetCompleteness(["a", "a", "b"], ["a"], ["a"]);
    assert.equal(r.requiredCount, 2);
    assert.equal(r.owned, 1);
    assert.equal(r.fromHere, 1);
    assert.deepEqual(r.missingStampIds, ["b"]);
  });
});
