import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  saleMoveSourceRefusal,
  saleMoveTargetRefusal,
  saleSetsMovedAction,
  type SaleMoveSide,
} from "../../src/lib/sale-move-rules";

// Moving sold sets to another sale of the same buyer (#2204): which sale may give sets away, which
// may take them, and how a move is named on the *to review* marker.

function side(overrides: Partial<SaleMoveSide> = {}): SaleMoveSide {
  return { id: "s1", saleNo: 12, platformId: "fb", currency: "PLN", buyerId: "ewa", status: "ordered", ...overrides };
}

describe("saleMoveSourceRefusal", () => {
  it("lets some of an open sale's sets go", () => {
    for (const status of ["ordered", "paid", "packed"]) {
      assert.equal(saleMoveSourceRefusal({ status }, 1, 3), null, status);
    }
    assert.equal(saleMoveSourceRefusal({ status: "ordered" }, 2, 3), null);
  });

  it("refuses nothing ticked, a sale already sent, and every set", () => {
    assert.match(saleMoveSourceRefusal({ status: "ordered" }, 0, 3)!, /at least one/);
    assert.match(saleMoveSourceRefusal({ status: "sent" }, 1, 3)!, /already been sent/);
    assert.match(saleMoveSourceRefusal({ status: "received" }, 1, 3)!, /already been sent/);
    assert.match(saleMoveSourceRefusal({ status: "ordered" }, 3, 3)!, /every sold set/);
    assert.match(saleMoveSourceRefusal({ status: "ordered" }, 1, 1)!, /every sold set/);
  });
});

describe("saleMoveTargetRefusal", () => {
  const source = side();

  it("takes another open sale of the same buyer, platform and currency", () => {
    for (const status of ["ordered", "paid", "packed"]) {
      assert.equal(saleMoveTargetRefusal(source, side({ id: "s2", saleNo: 13, status })), null, status);
    }
  });

  it("refuses itself, another buyer, platform or currency, and a sent sale — naming the sale", () => {
    assert.match(saleMoveTargetRefusal(source, side())!, /its own sets/);
    assert.match(saleMoveTargetRefusal(source, side({ id: "s2", saleNo: 13, buyerId: "adam" }))!, /#13 is to another buyer/);
    assert.match(saleMoveTargetRefusal(source, side({ id: "s2", saleNo: 13, buyerId: null }))!, /another buyer/);
    assert.match(saleMoveTargetRefusal(source, side({ id: "s2", saleNo: 13, platformId: "al" }))!, /another platform/);
    assert.match(saleMoveTargetRefusal(source, side({ id: "s2", saleNo: 13, currency: "EUR" }))!, /in EUR, not PLN/);
    assert.match(saleMoveTargetRefusal(source, side({ id: "s2", saleNo: 13, status: "sent" }))!, /already been sent/);
  });

  it("sends a sale with no buyer only to a new sale", () => {
    assert.match(
      saleMoveTargetRefusal(side({ buyerId: null }), side({ id: "s2", saleNo: 13, buyerId: null }))!,
      /only move to a new sale/
    );
  });
});

describe("saleSetsMovedAction", () => {
  it("names the sets, their offers once each in order, and the other sale", () => {
    assert.equal(saleSetsMovedAction([2680, null, 12, 2680], { to: 13 }), "moved 4 sets (offers #12, #2680) to sale #13");
    assert.equal(saleSetsMovedAction([2680], { from: 12 }), "moved 1 set (offer #2680) from sale #12");
    assert.equal(saleSetsMovedAction([null, null], { to: 13 }), "moved 2 sets to sale #13");
  });
});
