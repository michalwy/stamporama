import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Box } from "../../src/lib/scan-boxes";
import {
  QUARTER_TURNS,
  asQuarterTurn,
  isQuarterTurn,
  turnBetween,
  turnBy,
  turnedSize,
  unturnBox,
  type QuarterTurn,
} from "../../src/lib/tile-turn";

// A tile's quarter-turn (#1006). What matters is one fact that nothing on screen would reveal when
// wrong: a region asked for on the turned picture has to come back from **the same pixels** of the
// unturned one. A box taken from the wrong corner is still a believable piece of stamp.
//
// So the conversion is checked against an actual turn rather than against the formula restated: a
// small picture whose every pixel is labelled with where it started, turned clockwise the way `sharp`
// turns one, and every box on the turned picture asked for the labels it covers.

/** A `W × H` grid of labels, each the pixel's own `(x, y)` before any turn. */
function labelled(width: number, height: number): string[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => `${x},${y}`)
  );
}

/** One quarter clockwise: the bottom row becomes the left column. */
function turnClockwise(grid: string[][]): string[][] {
  const height = grid.length;
  const width = grid[0].length;
  return Array.from({ length: width }, (_, y) =>
    Array.from({ length: height }, (_, x) => grid[height - 1 - x][y])
  );
}

function turned(grid: string[][], turn: QuarterTurn): string[][] {
  let out = grid;
  for (let i = 0; i < turn / 90; i++) out = turnClockwise(out);
  return out;
}

function labelsIn(grid: string[][], box: Box): Set<string> {
  const out = new Set<string>();
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) out.add(grid[y][x]);
  }
  return out;
}

describe("unturnBox", () => {
  const W = 5;
  const H = 3;
  const picture = labelled(W, H);

  for (const turn of QUARTER_TURNS) {
    it(`finds the same pixels on the unturned picture at ${turn}°`, () => {
      const drawn = turned(picture, turn);
      const size = turnedSize({ width: W, height: H }, turn);
      assert.equal(drawn[0].length, size.width);
      assert.equal(drawn.length, size.height);
      // Every box the turned picture can hold, not a hand-picked few: the corner cases are exactly
      // the boxes touching an edge.
      for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
          for (let h = 1; y + h <= size.height; h++) {
            for (let w = 1; x + w <= size.width; w++) {
              const box = { x, y, w, h };
              const back = unturnBox(box, turn, { width: W, height: H });
              assert.deepEqual(
                labelsIn(picture, back),
                labelsIn(drawn, box),
                `box ${JSON.stringify(box)} at ${turn}°`
              );
            }
          }
        }
      }
    });
  }
});

describe("quarter-turn arithmetic", () => {
  it("turns right and left round the clock", () => {
    assert.equal(turnBy(0, 1), 90);
    assert.equal(turnBy(270, 1), 0);
    assert.equal(turnBy(0, -1), 270);
    assert.equal(turnBy(90, -1), 0);
  });

  it("measures how much further one turn is from another, clockwise", () => {
    assert.equal(turnBetween(90, 180), 90);
    assert.equal(turnBetween(270, 90), 180);
    assert.equal(turnBetween(90, 0), 270);
    assert.equal(turnBetween(180, 180), 0);
  });

  it("swaps a size only on its side, and is its own inverse", () => {
    assert.deepEqual(turnedSize({ width: 40, height: 30 }, 90), { width: 30, height: 40 });
    assert.deepEqual(turnedSize({ width: 40, height: 30 }, 180), { width: 40, height: 30 });
    for (const turn of QUARTER_TURNS) {
      assert.deepEqual(
        turnedSize(turnedSize({ width: 40, height: 30 }, turn), turn),
        { width: 40, height: 30 }
      );
    }
  });

  it("reads only what the application writes as a turn", () => {
    assert.ok(isQuarterTurn(270));
    assert.ok(!isQuarterTurn(45));
    assert.ok(!isQuarterTurn("90"));
    assert.equal(asQuarterTurn(45), 0);
    assert.equal(asQuarterTurn(null), 0);
    assert.equal(asQuarterTurn(180), 180);
  });
});
