import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pieceCopyOf } from "../../src/lib/carrier-value";

// What a copy row hands the valuation (#2359). How a piece is valued is `piece-valuation.test.ts`.

describe("pieceCopyOf — what a copy row hands the valuation", () => {
  it("reads the franking and the copy's own method", () => {
    assert.deepEqual(
      pieceCopyOf({ id: "i1", stampCount: 3, franking: "not_posted", valuationMethod: "fischer" }),
      { itemId: "i1", stampCount: 3, franking: "not_posted", method: "fischer" }
    );
  });

  it("reads an unknown value back as the default, and no method as following the area", () => {
    assert.deepEqual(
      pieceCopyOf({ id: "i2", stampCount: 1, franking: "bogus", valuationMethod: null }),
      { itemId: "i2", stampCount: 1, franking: "rate_correct", method: null }
    );
  });
});
