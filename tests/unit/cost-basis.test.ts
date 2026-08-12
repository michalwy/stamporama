import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCostBasis,
  aggregateCostBasis,
  aggregatePurchaseCostsByKey,
  type PurchaseCostInput,
} from "../../src/lib/cost-basis";

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

describe("aggregatePurchaseCostsByKey", () => {
  const key = { conditionId: "mnh", certificateStatusId: null, formatId: null };

  function copy(over: Partial<PurchaseCostInput>): PurchaseCostInput {
    return {
      ...key,
      costBasis: null,
      lotId: null,
      lotStatus: null,
      purchasedAt: null,
      ...over,
    };
  }

  it("is empty for no copies", () => {
    assert.deepEqual(aggregatePurchaseCostsByKey([]), []);
  });

  it("averages the frozen snapshots and carries min, max and the newest order date", () => {
    const result = aggregatePurchaseCostsByKey([
      copy({ costBasis: "10.00", lotId: "l1", lotStatus: "closed", purchasedAt: new Date("2026-01-05") }),
      copy({ costBasis: "20.00", lotId: "l2", lotStatus: "closed", purchasedAt: new Date("2026-03-09") }),
      copy({ costBasis: "30.00", lotId: "l3", lotStatus: "closed", purchasedAt: new Date("2026-02-01") }),
    ]);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      ...key,
      average: "20.00",
      min: "10.00",
      max: "30.00",
      knownCount: 3,
      pendingCount: 0,
      noneCount: 0,
      latestPurchasedAt: new Date("2026-03-09"),
    });
  });

  it("counts pending and unrecorded copies without letting them reach the figures", () => {
    const [cell] = aggregatePurchaseCostsByKey([
      copy({ costBasis: "8.00", lotId: "l1", lotStatus: "closed" }),
      copy({ costBasis: null, lotId: "l2", lotStatus: "open" }), // pending
      copy({ costBasis: null, lotId: "l3", lotStatus: "closed" }), // none (dropped)
      copy({}), // none (hand-added)
    ]);
    assert.equal(cell.average, "8.00");
    assert.equal(cell.min, "8.00");
    assert.equal(cell.max, "8.00");
    assert.equal(cell.knownCount, 1);
    assert.equal(cell.pendingCount, 1);
    assert.equal(cell.noneCount, 2);
  });

  it("keeps a key whose copies are all pending — counts, no figures", () => {
    const [cell] = aggregatePurchaseCostsByKey([
      copy({ costBasis: null, lotId: "l1", lotStatus: "open", purchasedAt: new Date("2026-04-01") }),
      copy({ costBasis: null, lotId: "l2", lotStatus: "open" }),
    ]);
    assert.equal(cell.average, null);
    assert.equal(cell.min, null);
    assert.equal(cell.max, null);
    assert.equal(cell.pendingCount, 2);
    // The date describes the priced copies; a pending one has no figure for it to date.
    assert.equal(cell.latestPurchasedAt, null);
  });

  it("keeps a key whose copies have no cost recorded at all", () => {
    const [cell] = aggregatePurchaseCostsByKey([copy({}), copy({})]);
    assert.equal(cell.average, null);
    assert.equal(cell.noneCount, 2);
    assert.equal(cell.pendingCount, 0);
  });

  it("groups on condition, certificate and format independently", () => {
    const result = aggregatePurchaseCostsByKey([
      copy({ costBasis: "10.00", lotId: "l1", lotStatus: "closed" }),
      copy({ conditionId: "used", costBasis: "4.00", lotId: "l2", lotStatus: "closed" }),
      copy({ certificateStatusId: "cert", costBasis: "50.00", lotId: "l3", lotStatus: "closed" }),
      copy({ formatId: "pair", costBasis: "25.00", lotId: "l4", lotStatus: "closed" }),
    ]);
    assert.equal(result.length, 4);
    assert.deepEqual(
      result.map((c) => c.average).sort(),
      ["10.00", "25.00", "4.00", "50.00"]
    );
  });
});
