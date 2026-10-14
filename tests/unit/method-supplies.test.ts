import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { changeMethodSupplies } from "../../src/lib/method-supplies";

// A shipping method's usual packing supplies applied to a sale (#1899, ADR-0068 §8): choosing a
// method fills its list in, changing it swaps the lines that still match the old list and keeps the
// ones the collector changed.

const ENV = "envelope";
const CARD = "card";
const BUBBLE = "bubble";

const letter = [
  { supplyId: ENV, quantity: 1 },
  { supplyId: CARD, quantity: 2 },
];
const parcel = [
  { supplyId: BUBBLE, quantity: 1 },
  { supplyId: CARD, quantity: 2 },
];

describe("changeMethodSupplies", () => {
  it("fills a new sale in with the method's list", () => {
    assert.deepEqual(changeMethodSupplies([], [], letter), { remove: [], add: letter });
  });

  it("fills in nothing for a method with no list", () => {
    assert.deepEqual(changeMethodSupplies([], [], []), { remove: [], add: [] });
  });

  it("swaps untouched lines for the new method's, keeping one that is the same in both", () => {
    const lines = [
      { id: "l1", supplyId: ENV, quantity: 1 },
      { id: "l2", supplyId: CARD, quantity: 2 },
    ];
    assert.deepEqual(changeMethodSupplies(lines, letter, parcel), {
      remove: ["l1"],
      add: [{ supplyId: BUBBLE, quantity: 1 }],
    });
  });

  it("keeps a line changed by hand, and adds no second line of its supply", () => {
    const lines = [
      { id: "l1", supplyId: ENV, quantity: 1 },
      { id: "l2", supplyId: CARD, quantity: 5 },
    ];
    assert.deepEqual(changeMethodSupplies(lines, letter, parcel), {
      remove: ["l1"],
      add: [{ supplyId: BUBBLE, quantity: 1 }],
    });
  });

  it("keeps a line the collector added that no list names", () => {
    const lines = [
      { id: "l1", supplyId: ENV, quantity: 1 },
      { id: "l2", supplyId: CARD, quantity: 2 },
      { id: "l3", supplyId: "tape", quantity: 1 },
    ];
    assert.deepEqual(changeMethodSupplies(lines, letter, []), { remove: ["l1", "l2"], add: [] });
  });

  it("adds a default the collector removed, when the method changes", () => {
    const lines = [{ id: "l2", supplyId: CARD, quantity: 2 }];
    assert.deepEqual(changeMethodSupplies(lines, letter, parcel), {
      remove: [],
      add: [{ supplyId: BUBBLE, quantity: 1 }],
    });
  });

  it("matches each entry of the old list to one line only", () => {
    const lines = [
      { id: "l1", supplyId: ENV, quantity: 1 },
      { id: "l2", supplyId: ENV, quantity: 1 },
    ];
    assert.deepEqual(changeMethodSupplies(lines, letter, []), { remove: ["l1"], add: [] });
  });
});
