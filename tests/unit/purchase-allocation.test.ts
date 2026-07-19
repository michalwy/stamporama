import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  distributeSharedCost,
  computeLotPool,
  allocateLot,
  closeLot,
  LotCloseBlockedError,
  type PurchaseCosts,
  type LotItem,
} from "../../src/lib/purchase-allocation";

// Helpers -------------------------------------------------------------------

function item(
  id: string,
  catalogPrice: number | null,
  deliveryState: LotItem["deliveryState"] = "delivered"
): LotItem {
  return { id, catalogPrice, deliveryState };
}

/** Sum of a list of cost-basis snapshots, in whole cents (avoids float compares). */
function sumCents(values: number[]): number {
  return values.reduce((s, v) => s + Math.round(v * 100), 0);
}

// Shared-cost distribution (ADR-0009 §3.1) ----------------------------------

describe("distributeSharedCost", () => {
  it("splits shipping across all lines by price", () => {
    const costs: PurchaseCosts = {
      shippingCost: 10,
      lots: [
        { id: "lot-a", price: 60 },
        { id: "lot-b", price: 30 },
      ],
      expenses: [{ id: "exp-1", price: 10 }],
      fxRateToBase: null,
    };
    const shares = distributeSharedCost(costs);
    assert.deepEqual(
      shares.map((s) => [s.id, s.sharedCost]),
      [
        ["lot-a", 6],
        ["lot-b", 3],
        ["exp-1", 1],
      ]
    );
    // Non-inventory expense absorbs its fair share so it does not inflate the stamps.
    assert.equal(sumCents(shares.map((s) => s.sharedCost)), 1000);
  });

  it("distributes leftover cents by largest remainder and ties out exactly", () => {
    const costs: PurchaseCosts = {
      shippingCost: 10,
      lots: [
        { id: "a", price: 1 },
        { id: "b", price: 1 },
        { id: "c", price: 1 },
      ],
      expenses: [],
      fxRateToBase: null,
    };
    const shares = distributeSharedCost(costs);
    // 10 / 3 = 3.33.. -> 3.34, 3.33, 3.33 summing to 10.00 exactly.
    assert.equal(sumCents(shares.map((s) => s.sharedCost)), 1000);
    assert.deepEqual(
      shares.map((s) => s.sharedCost),
      [3.34, 3.33, 3.33]
    );
  });

  it("is a no-op when there is no shipping", () => {
    const shares = distributeSharedCost({
      shippingCost: 0,
      lots: [{ id: "a", price: 5 }],
      expenses: [],
      fxRateToBase: null,
    });
    assert.equal(shares[0].sharedCost, 0);
  });
});

// Lot pool resolution (ADR-0009 §3.2) ---------------------------------------

describe("computeLotPool", () => {
  it("pool = lot price + shared-cost share (no FX)", () => {
    const costs: PurchaseCosts = {
      shippingCost: 10,
      lots: [
        { id: "lot-a", price: 60 },
        { id: "lot-b", price: 30 },
      ],
      expenses: [{ id: "exp-1", price: 10 }],
      fxRateToBase: null,
    };
    const pool = computeLotPool(costs, "lot-a");
    assert.equal(pool.price, 60);
    assert.equal(pool.sharedCost, 6);
    assert.equal(pool.poolTx, 66);
    assert.equal(pool.poolBase, 66);
  });

  it("converts the pool to base currency at the frozen FX rate", () => {
    // Scenario 8: amounts stored in purchase currency; base value uses frozen rate.
    const costs: PurchaseCosts = {
      shippingCost: 0,
      lots: [{ id: "lot-a", price: 100 }],
      expenses: [],
      fxRateToBase: 0.85, // e.g. USD purchase, EUR base
    };
    const pool = computeLotPool(costs, "lot-a");
    assert.equal(pool.poolTx, 100);
    assert.equal(pool.poolBase, 85);
  });

  it("throws for an unknown lot", () => {
    assert.throws(() =>
      computeLotPool(
        { shippingCost: 0, lots: [], expenses: [], fxRateToBase: null },
        "nope"
      )
    );
  });
});

// Scenario 1 — single stamp --------------------------------------------------

describe("allocateLot — single stamp (scenario 1)", () => {
  it("a lone item takes the whole pool", () => {
    const { snapshots, notDeliveredItemIds } = allocateLot(42, [item("i1", 5)]);
    assert.deepEqual(snapshots, [{ itemId: "i1", costBasis: 42 }]);
    assert.deepEqual(notDeliveredItemIds, []);
  });
});

// Scenario 2 — whole issue (one lot, many items) -----------------------------

describe("allocateLot — whole issue (scenario 2)", () => {
  it("splits the pool by each item's catalog-price weight", () => {
    // Pool 100 over weights 50 / 30 / 20 -> 50 / 30 / 20.
    const { snapshots } = allocateLot(100, [
      item("a", 50),
      item("b", 30),
      item("c", 20),
    ]);
    assert.deepEqual(snapshots, [
      { itemId: "a", costBasis: 50 },
      { itemId: "b", costBasis: 30 },
      { itemId: "c", costBasis: 20 },
    ]);
    assert.equal(sumCents(snapshots.map((s) => s.costBasis)), 10000);
  });
});

// Scenario 3 — multi-lot order -----------------------------------------------

describe("closeLot — multi-lot order (scenario 3)", () => {
  it("each lot's pool reflects its own share of shipping, then splits to items", () => {
    const costs: PurchaseCosts = {
      shippingCost: 20,
      lots: [
        { id: "lot-a", price: 60 }, // share 12 -> pool 72
        { id: "lot-b", price: 40 }, // share 8  -> pool 48
      ],
      expenses: [],
      fxRateToBase: null,
    };
    const a = closeLot(costs, "lot-a", [item("a1", 2), item("a2", 1)]);
    // pool 72 over weights 2/1 -> 48 / 24
    assert.deepEqual(a.snapshots, [
      { itemId: "a1", costBasis: 48 },
      { itemId: "a2", costBasis: 24 },
    ]);
    const b = closeLot(costs, "lot-b", [item("b1", 1)]);
    assert.deepEqual(b.snapshots, [{ itemId: "b1", costBasis: 48 }]);
  });
});

// Scenario 4 — big lot: exact reconciliation ---------------------------------

describe("allocateLot — big lot reconciles to the cent (scenario 4)", () => {
  it("many equal items split an awkward pool with no lost cents", () => {
    const items = Array.from({ length: 7 }, (_, i) => item(`i${i}`, 1));
    const { snapshots } = allocateLot(100, items);
    // 100 / 7 = 14.2857.. -> floor 14.28 leaves 4 leftover cents, so four 14.29 and
    // three 14.28, summing to 100.00 exactly.
    assert.equal(sumCents(snapshots.map((s) => s.costBasis)), 10000);
    const distinct = new Set(snapshots.map((s) => s.costBasis));
    assert.deepEqual([...distinct].sort(), [14.28, 14.29]);
    // Largest-remainder gives the extra cents to the earliest indices (all ties here).
    assert.deepEqual(
      snapshots.map((s) => s.costBasis),
      [14.29, 14.29, 14.29, 14.29, 14.28, 14.28, 14.28]
    );
  });

  it("weights the split, not just an equal division", () => {
    const { snapshots } = allocateLot(10, [
      item("a", 1),
      item("b", 1),
      item("c", 1),
    ]);
    assert.equal(sumCents(snapshots.map((s) => s.costBasis)), 1000);
    assert.deepEqual(
      snapshots.map((s) => s.costBasis),
      [3.34, 3.33, 3.33]
    );
  });
});

// Delivery axis (ADR-0009 §5) ------------------------------------------------

describe("allocateLot — not-delivered redistribution (§5)", () => {
  it("drops the item and redistributes its share to survivors", () => {
    const { snapshots, notDeliveredItemIds } = allocateLot(90, [
      item("a", 1),
      item("b", 1),
      item("c", 1, "not_delivered"),
    ]);
    // c is removed; 90 splits over a/b only -> 45 / 45.
    assert.deepEqual(notDeliveredItemIds, ["c"]);
    assert.deepEqual(snapshots, [
      { itemId: "a", costBasis: 45 },
      { itemId: "b", costBasis: 45 },
    ]);
    assert.equal(sumCents(snapshots.map((s) => s.costBasis)), 9000);
  });

  it("does not require a catalog price on a not-delivered item", () => {
    // A missing price on a removed item must not block the close.
    const { snapshots } = allocateLot(50, [
      item("a", 1),
      item("gone", null, "not_delivered"),
    ]);
    assert.deepEqual(snapshots, [{ itemId: "a", costBasis: 50 }]);
  });
});

describe("allocateLot — damaged loss (§5)", () => {
  it("keeps the damaged item in the pool with its own share (no redistribution)", () => {
    const { snapshots, notDeliveredItemIds } = allocateLot(100, [
      item("good", 1),
      item("broken", 1, "damaged"),
    ]);
    // Damaged copy stays and keeps its cost-basis; it does not inflate the others.
    assert.deepEqual(notDeliveredItemIds, []);
    assert.deepEqual(snapshots, [
      { itemId: "good", costBasis: 50 },
      { itemId: "broken", costBasis: 50 },
    ]);
  });
});

// Close-blocking validation (ADR-0009 §5 / §9) -------------------------------

describe("allocateLot — close-blocking", () => {
  it("throws with the offending item ids when a staying item lacks a price", () => {
    try {
      allocateLot(100, [item("a", 5), item("b", null), item("c", null)]);
      assert.fail("expected LotCloseBlockedError");
    } catch (err) {
      assert.ok(err instanceof LotCloseBlockedError);
      assert.equal(err.reason, "missing-price");
      assert.deepEqual(err.itemIds, ["b", "c"]);
    }
  });

  it("throws zero-weight when a positive pool meets an all-zero weight base", () => {
    try {
      allocateLot(30, [item("a", 0), item("b", 0)]);
      assert.fail("expected LotCloseBlockedError");
    } catch (err) {
      assert.ok(err instanceof LotCloseBlockedError);
      assert.equal(err.reason, "zero-weight");
      assert.deepEqual(err.itemIds, ["a", "b"]);
    }
  });

  it("allows a zero pool over zero weights (nothing to split)", () => {
    const { snapshots } = allocateLot(0, [item("a", 0), item("b", 0)]);
    assert.deepEqual(snapshots, [
      { itemId: "a", costBasis: 0 },
      { itemId: "b", costBasis: 0 },
    ]);
  });
});
