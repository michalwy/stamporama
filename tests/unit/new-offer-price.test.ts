import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newOfferFigure, newOfferFigureAmount } from "../../src/lib/new-offer-price";

// The figure the New offer form suggests from the copies going in (#2302): one set's, so the
// packaging decides — the sum for one set holding all, one piece's for one set each.

describe("newOfferFigure", () => {
  it("sums the copies of a set sold together — the three-value series", () => {
    assert.deepEqual(newOfferFigure(["1.20", "2.50", "4.05"], "one-set"), {
      kind: "figure",
      amount: "7.75",
      summed: true,
    });
  });

  it("sums duplicates too when they go in as one set", () => {
    assert.deepEqual(newOfferFigure(["3.00", "3.00"], "one-set"), { kind: "figure", amount: "6.00", summed: true });
  });

  it("adds in cents, so the sum carries no floating-point residue", () => {
    assert.equal(newOfferFigureAmount(newOfferFigure(["0.10", "0.20"], "one-set")), "0.30");
  });

  it("prices one set each at one piece's figure when the copies share it", () => {
    assert.deepEqual(newOfferFigure(["3.00", "3.00", "3"], "per-copy"), {
      kind: "figure",
      amount: "3.00",
      summed: false,
    });
  });

  it("suggests nothing for one set each when the figures differ", () => {
    assert.deepEqual(newOfferFigure(["3.00", "4.00"], "per-copy"), { kind: "differ" });
    assert.equal(newOfferFigureAmount({ kind: "differ" }), "");
  });

  it("takes a single copy's figure whatever the packaging", () => {
    for (const packaging of ["one-set", "per-copy"] as const) {
      assert.deepEqual(newOfferFigure(["5.5"], packaging), { kind: "figure", amount: "5.50", summed: false });
    }
  });

  it("suggests nothing while a copy has no figure, and counts those that have none", () => {
    assert.deepEqual(newOfferFigure(["1.00", null, undefined, ""], "one-set"), { kind: "missing", missing: 3 });
    assert.deepEqual(newOfferFigure(["1.00", null], "per-copy"), { kind: "missing", missing: 1 });
  });

  it("has nothing to say about no copies", () => {
    assert.deepEqual(newOfferFigure([], "one-set"), { kind: "none" });
  });
});
