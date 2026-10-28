import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  saleSupplyLimit,
  saleSupplyOptionLabel,
  saleSupplyOptions,
  saleSupplyQuantityError,
} from "../../src/lib/sale-supply-pick";

// A sale's supply-line dialog (#2229): only supplies on hand are offered, up to what is on hand; a
// line being changed keeps its own supply and counts what it took as available.

const SUPPLIES = [
  { id: "c4", name: "C4 envelope", onHand: 12 },
  { id: "c6", name: "C6 envelope", onHand: 0 },
  { id: "card", name: "Transport card", onHand: 3 },
];

describe("saleSupplyOptions", () => {
  it("offers only supplies with units on hand when adding", () => {
    assert.deepEqual(
      saleSupplyOptions(SUPPLIES).map((s) => s.id),
      ["c4", "card"]
    );
  });

  it("keeps a changed line's own supply even with none on hand", () => {
    assert.deepEqual(
      saleSupplyOptions(SUPPLIES, { supplyId: "c6", quantity: 2 }).map((s) => s.id),
      ["c4", "c6", "card"]
    );
  });

  it("offers nothing when nothing is on hand", () => {
    assert.deepEqual(saleSupplyOptions([{ id: "c6", name: "C6", onHand: 0 }]), []);
  });
});

describe("saleSupplyLimit", () => {
  it("is what is on hand for a new line", () => {
    assert.equal(saleSupplyLimit(SUPPLIES, "c4"), 12);
    assert.equal(saleSupplyLimit(SUPPLIES, "c6"), 0);
    assert.equal(saleSupplyLimit(SUPPLIES, "missing"), 0);
  });

  it("adds what a changed line already used of the same supply", () => {
    assert.equal(saleSupplyLimit(SUPPLIES, "c4", { supplyId: "c4", quantity: 5 }), 17);
    // A short line has nothing left on hand: it may keep its quantity, not raise it.
    assert.equal(saleSupplyLimit(SUPPLIES, "c6", { supplyId: "c6", quantity: 2 }), 2);
  });

  it("is only what is on hand when a changed line moves to another supply", () => {
    assert.equal(saleSupplyLimit(SUPPLIES, "card", { supplyId: "c4", quantity: 5 }), 3);
  });
});

describe("saleSupplyOptionLabel", () => {
  it("names the supply with what is on hand", () => {
    assert.equal(saleSupplyOptionLabel(SUPPLIES[0]), "C4 envelope — 12 on hand");
  });
});

describe("saleSupplyQuantityError", () => {
  it("refuses a whole number above the limit", () => {
    assert.equal(saleSupplyQuantityError("13", 12), "Max 12");
    assert.equal(saleSupplyQuantityError(" 4 ", 3), "Max 3");
  });

  it("accepts the limit and below", () => {
    assert.equal(saleSupplyQuantityError("12", 12), null);
    assert.equal(saleSupplyQuantityError("1", 12), null);
  });

  it("leaves what is not a whole number to the server's message", () => {
    assert.equal(saleSupplyQuantityError("", 3), null);
    assert.equal(saleSupplyQuantityError("abc", 3), null);
    assert.equal(saleSupplyQuantityError("1.5", 3), null);
  });
});
