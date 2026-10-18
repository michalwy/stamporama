import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freePositions, isLockedTile, outsideLocked } from "../../src/lib/scan-recut";

// The pure half of re-cutting around copies (#2055): what is locked, which numbers the new tiles
// take, and which proposed boxes are a copy's stamp found again.

describe("scan-recut (#2055)", () => {
  it("locks only a tile that has become a copy", () => {
    assert.equal(isLockedTile({ state: "consumed" }), true);
    for (const state of ["unidentified", "parked", "discarded"]) {
      assert.equal(isLockedTile({ state }), false, state);
    }
  });

  it("gives new tiles the lowest numbers no copy holds, in order", () => {
    assert.deepEqual(freePositions([], 3), [0, 1, 2]);
    assert.deepEqual(freePositions([1], 3), [0, 2, 3]);
    assert.deepEqual(freePositions([0, 2, 3], 3), [1, 4, 5]);
    assert.deepEqual(freePositions([4], 2), [0, 1]);
    assert.deepEqual(freePositions([0, 1], 0), []);
  });

  it("drops a proposed box whose centre lies in a locked one, and keeps the rest", () => {
    const locked = [{ x: 100, y: 100, w: 200, h: 200 }];
    const same = { x: 110, y: 90, w: 190, h: 220 };
    const beside = { x: 400, y: 100, w: 200, h: 200 };
    // Overlapping the copy's box at an edge is not the copy's stamp: its centre is outside.
    const edge = { x: 250, y: 100, w: 200, h: 200 };
    assert.deepEqual(outsideLocked([same, beside, edge], locked), [beside, edge]);
    assert.deepEqual(outsideLocked([same, beside], []), [same, beside]);
  });
});
