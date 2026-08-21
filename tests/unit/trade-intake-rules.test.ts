import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  arrivedLines,
  carryOverPool,
  findSubstitutions,
  isCarryOverSettled,
  splitCarryOverPool,
  tradeLotPendingMessage,
  tradeUnrecordedCostNote,
  type GivenCopy,
  type IncomingLine,
} from "../../src/lib/trade-intake-rules";

// Closing a trade into a purchase (#644; ADR-0039 §12). What matters here: the pool is the cost of
// everything that left and nothing is invented on either side, the split reconciles to the cent and
// never refuses, only material that actually arrived gets a lot, and a substitution is derived from
// two facts that already exist rather than stored as a third.

const given = (over: Partial<GivenCopy> & { itemId: string }): GivenCopy => ({
  fulfillment: "fulfilled",
  costBasis: null,
  lotId: null,
  lotStatus: null,
  ...over,
});

describe("the carried-over pool", () => {
  it("sums the frozen cost basis of everything that left", () => {
    const pool = carryOverPool([
      given({ itemId: "a", costBasis: "10.00", lotId: "l1", lotStatus: "closed" }),
      given({ itemId: "b", costBasis: "20.50", lotId: "l1", lotStatus: "closed" }),
    ]);
    assert.equal(pool.total, 30.5);
    assert.equal(pool.knownCount, 2);
    assert.ok(isCarryOverSettled(pool));
  });

  it("counts a copy lost in the post, because it left too", () => {
    const pool = carryOverPool([
      given({ itemId: "a", fulfillment: "fulfilled", costBasis: "10.00", lotId: "l", lotStatus: "closed" }),
      given({ itemId: "b", fulfillment: "missing", costBasis: "5.00", lotId: "l", lotStatus: "closed" }),
    ]);
    assert.equal(pool.total, 15);
  });

  it("leaves a withdrawn line out — its copy never went in the envelope", () => {
    const pool = carryOverPool([
      given({ itemId: "a", costBasis: "10.00", lotId: "l", lotStatus: "closed" }),
      given({ itemId: "b", fulfillment: "withdrawn", costBasis: "99.00", lotId: "l", lotStatus: "closed" }),
    ]);
    assert.equal(pool.total, 10);
    assert.equal(pool.knownCount, 1);
  });

  it("holds the pool open on a copy whose own lot is still open, naming it", () => {
    const pool = carryOverPool([
      given({ itemId: "a", costBasis: "10.00", lotId: "l1", lotStatus: "closed" }),
      given({ itemId: "b", lotId: "l2", lotStatus: "open" }),
    ]);
    assert.deepEqual(pool.pendingItemIds, ["b"]);
    assert.equal(isCarryOverSettled(pool), false);
    // The known half is still summed: what is missing is a share, not the whole figure.
    assert.equal(pool.total, 10);
  });

  it("carries nothing, and blocks nothing, for a copy that cost nothing on record", () => {
    const pool = carryOverPool([given({ itemId: "a" })]);
    assert.equal(pool.total, 0);
    assert.equal(pool.noneCount, 1);
    assert.ok(isCarryOverSettled(pool));
    assert.match(tradeUnrecordedCostNote(pool)!, /no purchase cost recorded/);
  });

  it("says nothing when every copy carried a cost", () => {
    const pool = carryOverPool([
      given({ itemId: "a", costBasis: "1.00", lotId: "l", lotStatus: "closed" }),
    ]);
    assert.equal(tradeUnrecordedCostNote(pool), null);
  });
});

const line = (over: Partial<IncomingLine> & { lineId: string }): IncomingLine => ({
  fulfillment: "fulfilled",
  ownValue: null,
  quantity: 1,
  ...over,
});

describe("splitting it across the receive lines", () => {
  it("weighs by own value times quantity and reconciles to the cent", () => {
    const shares = splitCarryOverPool(100, [
      line({ lineId: "x", ownValue: 10, quantity: 1 }),
      line({ lineId: "y", ownValue: 10, quantity: 2 }),
    ]);
    assert.deepEqual(shares, [
      { lineId: "x", price: 33.33 },
      { lineId: "y", price: 66.67 },
    ]);
    assert.equal(shares.reduce((s, r) => s + r.price, 0), 100);
  });

  it("gives a lot only to what actually arrived", () => {
    const lines = [
      line({ lineId: "x", ownValue: 10 }),
      line({ lineId: "y", ownValue: 10, fulfillment: "missing" }),
      line({ lineId: "z", ownValue: 10, fulfillment: "withdrawn" }),
    ];
    assert.deepEqual(arrivedLines(lines).map((l) => l.lineId), ["x"]);
    assert.deepEqual(splitCarryOverPool(50, lines), [{ lineId: "x", price: 50 }]);
  });

  it("falls back to pieces, then to one share each, rather than refusing", () => {
    assert.deepEqual(
      splitCarryOverPool(30, [line({ lineId: "x", quantity: 1 }), line({ lineId: "y", quantity: 2 })]),
      [
        { lineId: "x", price: 10 },
        { lineId: "y", price: 20 },
      ]
    );
    assert.deepEqual(
      splitCarryOverPool(10, [
        line({ lineId: "x", quantity: 0 }),
        line({ lineId: "y", quantity: 0 }),
      ]),
      [
        { lineId: "x", price: 5 },
        { lineId: "y", price: 5 },
      ]
    );
  });

  it("splits a pool of nothing into nothing — a gift is not a fault", () => {
    assert.deepEqual(splitCarryOverPool(0, [line({ lineId: "x", ownValue: 10 })]), [
      { lineId: "x", price: 0 },
    ]);
  });

  it("has nothing to split when nothing arrived", () => {
    assert.deepEqual(splitCarryOverPool(80, [line({ lineId: "x", fulfillment: "missing" })]), []);
  });
});

describe("substitution", () => {
  it("is the line and the copy disagreeing, and nothing more", () => {
    assert.deepEqual(
      findSubstitutions([
        { lineId: "l1", itemId: "i1", promisedStampId: "s1", arrivedStampId: "s2" },
        { lineId: "l2", itemId: "i2", promisedStampId: "s3", arrivedStampId: "s3" },
        { lineId: "l3", itemId: "i3", promisedStampId: null, arrivedStampId: "s4" },
      ]),
      [{ lineId: "l1", itemId: "i1", promisedStampId: "s1", arrivedStampId: "s2" }]
    );
  });
});

describe("the lot gate", () => {
  it("names what it is waiting on, and says nothing when it waits on nothing", () => {
    assert.equal(tradeLotPendingMessage([]), null);
    assert.match(tradeLotPendingMessage(["order #12"])!, /is still waiting on an order of its own/);
    assert.match(
      tradeLotPendingMessage(["order #12", "order #13"])!,
      /are still waiting on orders of their own: order #12, order #13/
    );
  });
});
