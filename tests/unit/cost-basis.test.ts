import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCostBasis, aggregateCostBasis } from "../../src/lib/cost-basis";

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

describe("aggregateCostBasis", () => {
  it("is an empty total over no copies", () => {
    assert.deepEqual(aggregateCostBasis([], "EUR"), {
      baseCurrency: "EUR",
      totalCostBasis: "0.00",
      knownCount: 0,
      pendingCount: 0,
      noneCount: 0,
    });
  });

  it("sums frozen snapshots and splits copies by cost-basis state", () => {
    const result = aggregateCostBasis(
      [
        { costBasis: "12.50", lotId: "lot-1", lotStatus: "closed" }, // known
        { costBasis: "7.25", lotId: "lot-2", lotStatus: "closed" }, // known
        { costBasis: null, lotId: "lot-3", lotStatus: "open" }, // pending
        { costBasis: null, lotId: "lot-4", lotStatus: "closed" }, // none (dropped)
        { costBasis: null, lotId: null, lotStatus: null }, // none (no lot)
      ],
      "EUR"
    );
    assert.deepEqual(result, {
      baseCurrency: "EUR",
      totalCostBasis: "19.75",
      knownCount: 2,
      pendingCount: 1,
      noneCount: 2,
    });
  });

  it("counts pending copies but never sums them into the total", () => {
    const result = aggregateCostBasis(
      [
        { costBasis: null, lotId: "lot-1", lotStatus: "open" },
        { costBasis: null, lotId: "lot-2", lotStatus: "open" },
      ],
      "USD"
    );
    assert.equal(result.totalCostBasis, "0.00");
    assert.equal(result.pendingCount, 2);
    assert.equal(result.knownCount, 0);
  });
});
