import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeChecklistCompleteness,
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
