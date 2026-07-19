import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCostBasis } from "../../src/lib/cost-basis";

describe("resolveCostBasis", () => {
  it("returns the frozen amount as `known` when a snapshot is present", () => {
    assert.deepEqual(
      resolveCostBasis({ costBasis: "12.34", lotId: "lot-1", lotStatus: "closed" }),
      { state: "known", amount: "12.34" }
    );
  });

  it("prefers a frozen snapshot even on an open lot (snapshot always wins)", () => {
    // Defensive: a snapshot should not coexist with an open lot, but if it does the
    // frozen value is authoritative, never overridden by a `pending` reading.
    assert.deepEqual(
      resolveCostBasis({ costBasis: "5.00", lotId: "lot-1", lotStatus: "open" }),
      { state: "known", amount: "5.00" }
    );
  });

  it("is `pending` for a null snapshot on an open lot", () => {
    assert.deepEqual(
      resolveCostBasis({ costBasis: null, lotId: "lot-1", lotStatus: "open" }),
      { state: "pending" }
    );
  });

  it("is `none` for a null snapshot on a closed lot (e.g. a not-delivered copy)", () => {
    assert.deepEqual(
      resolveCostBasis({ costBasis: null, lotId: "lot-1", lotStatus: "closed" }),
      { state: "none" }
    );
  });

  it("is `none` for a copy with no acquisition lot", () => {
    assert.deepEqual(
      resolveCostBasis({ costBasis: null, lotId: null, lotStatus: null }),
      { state: "none" }
    );
  });

  it("is `none` when a lot id lingers without a resolvable status", () => {
    assert.deepEqual(
      resolveCostBasis({ costBasis: null, lotId: "lot-1", lotStatus: null }),
      { state: "none" }
    );
  });
});
