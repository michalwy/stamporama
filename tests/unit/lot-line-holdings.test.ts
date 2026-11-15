import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOnTheWay,
  lineHoldingsLabel,
  lotHoldsCopies,
  showsHoldings,
  summarizeLineHoldings,
} from "../../src/lib/lot-line-holdings";
import { ON_THE_WAY_DELIVERY_STATES } from "../../src/lib/delivery-state";

// An auction lot line shows the copies you already hold, and those bought and still on the way
// (#2543). The chip counts the line's own condition; the rest are listed in its tooltip.

const DICTIONARY = [
  { id: "mnh", abbreviation: "MNH", name: "Mint never hinged" },
  { id: "mh", abbreviation: "MH", name: "Mint hinged" },
  { id: "u", abbreviation: "U", name: "Used" },
];

describe("lot line holdings (#2543)", () => {
  it("on the way is ordered or in transit; an arrived copy waiting to be sorted is held", () => {
    assert.deepEqual([...ON_THE_WAY_DELIVERY_STATES].sort(), ["in_transit", "ordered"]);
    assert.equal(isOnTheWay("ordered"), true);
    assert.equal(isOnTheWay("in_transit"), true);
    assert.equal(isOnTheWay("to_sort"), false);
    assert.equal(isOnTheWay("delivered"), false);
  });

  it("two held at the line's condition reads *held 2*; one more on the way adds a clause", () => {
    const two = summarizeLineHoldings(
      [{ conditionId: "mnh", deliveryState: "delivered", count: 2 }],
      ["mnh"],
      DICTIONARY
    );
    assert.ok(two);
    assert.equal(lineHoldingsLabel(two), "held 2");

    const more = summarizeLineHoldings(
      [
        { conditionId: "mnh", deliveryState: "delivered", count: 1 },
        { conditionId: "mnh", deliveryState: "to_sort", count: 1 },
        { conditionId: "mnh", deliveryState: "ordered", count: 1 },
      ],
      ["mnh"],
      DICTIONARY
    );
    assert.ok(more);
    assert.equal(more.held, 2);
    assert.equal(more.onTheWay, 1);
    assert.equal(lineHoldingsLabel(more), "held 2 · 1 on the way");
    assert.equal(lineHoldingsLabel({ held: 0, onTheWay: 1 }), "1 on the way");
  });

  it("another condition is listed, after the line's own, but not counted on the chip", () => {
    const holdings = summarizeLineHoldings(
      [
        { conditionId: "u", deliveryState: "delivered", count: 3 },
        { conditionId: "mh", deliveryState: "delivered", count: 1 },
        { conditionId: "mnh", deliveryState: "in_transit", count: 1 },
      ],
      ["mnh"],
      DICTIONARY
    );
    assert.ok(holdings);
    assert.equal(holdings.held, 0);
    assert.equal(holdings.onTheWay, 1);
    assert.deepEqual(
      holdings.conditions.map((c) => [c.abbreviation, c.own, c.held, c.onTheWay]),
      [
        ["MNH", true, 0, 1],
        ["MH", false, 1, 0],
        ["U", false, 3, 0],
      ]
    );
  });

  it("a line held only at another condition shows no chip, but the tooltip has the copy", () => {
    const holdings = summarizeLineHoldings(
      [{ conditionId: "mh", deliveryState: "delivered", count: 1 }],
      ["mnh"],
      DICTIONARY
    );
    assert.ok(holdings);
    assert.equal(showsHoldings(holdings), false);
    assert.equal(lotHoldsCopies([{ holdings }]), false);
  });

  it("a line whose condition is open counts every condition it may be in", () => {
    const holdings = summarizeLineHoldings(
      [
        { conditionId: "mnh", deliveryState: "delivered", count: 1 },
        { conditionId: "mh", deliveryState: "delivered", count: 2 },
        { conditionId: "u", deliveryState: "delivered", count: 5 },
      ],
      ["mnh", "mh"],
      DICTIONARY
    );
    assert.ok(holdings);
    assert.equal(lineHoldingsLabel(holdings), "held 3");
  });

  it("nothing held is null, and a lot with a chip on any line is marked", () => {
    assert.equal(summarizeLineHoldings([], ["mnh"], DICTIONARY), null);
    assert.equal(showsHoldings(null), false);
    const held = summarizeLineHoldings(
      [{ conditionId: "mnh", deliveryState: "delivered", count: 1 }],
      ["mnh"],
      DICTIONARY
    );
    assert.equal(lotHoldsCopies([{ holdings: null }, { holdings: held }]), true);
    assert.equal(lotHoldsCopies([]), false);
  });
});
