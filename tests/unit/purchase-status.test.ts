import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PURCHASE_STATUSES,
  describePurchaseWorkLeft,
  hasPurchaseArrived,
  isPurchaseStatus,
  isPurchaseWorkDone,
  purchaseStatusLabel,
} from "../../src/lib/purchase-status";

// A purchase's delivery status and what stands between an arrived order and *Completed* (#1449).

describe("purchase status vocabulary", () => {
  it("runs Preparing → In transit → Arrived → Completed", () => {
    assert.deepEqual([...PURCHASE_STATUSES], ["preparing", "in_transit", "arrived", "completed"]);
    assert.deepEqual(PURCHASE_STATUSES.map(purchaseStatusLabel), [
      "Preparing",
      "In transit",
      "Arrived",
      "Completed",
    ]);
  });

  it("accepts only its own values", () => {
    assert.ok(isPurchaseStatus("completed"));
    assert.ok(!isPurchaseStatus("done"));
    assert.ok(!isPurchaseStatus(null));
    assert.ok(!isPurchaseStatus(""));
  });

  it("treats a completed order as arrived", () => {
    assert.ok(hasPurchaseArrived("arrived"));
    assert.ok(hasPurchaseArrived("completed"));
    assert.ok(!hasPurchaseArrived("preparing"));
    assert.ok(!hasPurchaseArrived("in_transit"));
  });
});

describe("work left before an order is completed", () => {
  const none = { toSort: 0, tiles: 0, openLots: 0 };

  it("is done only when nothing is to sort, no tile is waiting and every lot is closed", () => {
    assert.ok(isPurchaseWorkDone(none));
    assert.ok(!isPurchaseWorkDone({ ...none, toSort: 1 }));
    assert.ok(!isPurchaseWorkDone({ ...none, tiles: 1 }));
    assert.ok(!isPurchaseWorkDone({ ...none, openLots: 1 }));
  });

  it("says nothing when nothing is left", () => {
    assert.deepEqual(describePurchaseWorkLeft(none), []);
  });

  it("names each kind that has any, in the order the pass goes", () => {
    assert.deepEqual(describePurchaseWorkLeft({ toSort: 3, tiles: 2, openLots: 1 }), [
      "3 copies to sort",
      "2 scan tiles not yet identified",
      "1 open lot",
    ]);
    assert.deepEqual(describePurchaseWorkLeft({ toSort: 1, tiles: 1, openLots: 0 }), [
      "1 copy to sort",
      "1 scan tile not yet identified",
    ]);
    assert.deepEqual(describePurchaseWorkLeft({ toSort: 0, tiles: 0, openLots: 4 }), ["4 open lots"]);
  });
});
