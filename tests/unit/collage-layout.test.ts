import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layOutCollage, type CollageTileSize } from "../../src/lib/collage-layout";

const size = (width: number, height: number): CollageTileSize => ({ width, height });

/** Gap at 10% of the stamp and a strip at 10% of the finished image (#337) — with 100-tall,
 * 100-wide tiles that is 10 px of gap and a strip in the same ballpark, which is what most of these
 * cases are written against. Each expectation below states the strip it works out to: the strip is
 * solved against the canvas it is part of, so it does not follow from the tile alone. */
const style = (over: Partial<{ columns: number; gapPercent: number; labelPercent: number }> = {}) => ({
  columns: 2,
  gapPercent: 10,
  labelPercent: 10,
  ...over,
});

describe("layOutCollage", () => {
  it("packs a single tile as a 1×1 collage with margin and label strip", () => {
    // One 140-tall tile: the gap resolves against it (14), the strip against the 187-tall canvas it
    // is itself part of (19) — 10% of the longest edge, solved rather than multiplied out.
    const layout = layOutCollage([size(100, 140)], style({ columns: 3 }));

    assert.equal(layout.rowCount, 1);
    assert.equal(layout.referenceHeight, 140);
    assert.equal(layout.gap, 14);
    assert.equal(layout.labelStripHeight, 19);
    assert.equal(layout.width, 100 + 14 * 2);
    assert.equal(layout.height, 140 + 19 + 14 * 2);
    assert.deepEqual(layout.tiles[0], {
      x: 14,
      y: 14,
      width: 100,
      height: 140,
      label: { x: 14, y: 154, width: 100, height: 19 },
    });
  });

  it("scales the whole geometry with the stamps, so one template fits any scan resolution", () => {
    const small = layOutCollage([size(100, 100), size(100, 100)], style());
    const large = layOutCollage([size(400, 400), size(400, 400)], style());

    assert.equal(large.gap, small.gap * 4);
    assert.equal(large.labelStripHeight, small.labelStripHeight * 4);
    assert.equal(large.width, small.width * 4);
    assert.equal(large.height, small.height * 4);
  });

  it("takes the gap of the median tile, not the tallest", () => {
    // One souvenir sheet among three ordinary stamps must not inflate the whole page's spacing.
    const layout = layOutCollage(
      [size(100, 100), size(100, 100), size(100, 100), size(300, 900)],
      style({ columns: 4 })
    );

    assert.equal(layout.referenceHeight, 100);
    assert.equal(layout.gap, 10);
    // The strip does not follow the stamps at all: it is 10% of the canvas the sheet made tall.
    assert.equal(layout.labelStripHeight, Math.round(layout.height / 10));
  });

  it("shrinks the canvas to the contents rather than to the template's capacity", () => {
    // Two tiles under a 4-column template: one row, no reserved empty cells.
    const layout = layOutCollage([size(100, 100), size(100, 100)], style({ columns: 4 }));

    assert.equal(layout.rowCount, 1);
    assert.equal(layout.width, 100 + 10 + 100 + 10 * 2);
    // Wider than it is tall, so the strip is 10% of the width: 23.
    assert.equal(layout.height, 100 + 23 + 10 * 2);
  });

  it("keeps native tile sizes so true relative proportions survive", () => {
    const layout = layOutCollage([size(80, 100), size(160, 200)], style());

    assert.deepEqual(
      layout.tiles.map((t) => [t.width, t.height]),
      [
        [80, 100],
        [160, 200],
      ]
    );
  });

  it("centres a shorter tile vertically in its row and sits the row's labels on one baseline", () => {
    const layout = layOutCollage([size(100, 100), size(100, 200)], style());

    // Row content band is 200 tall; the 100-tall tile is centred in it.
    assert.equal(layout.tiles[0].y, 10 + 50);
    assert.equal(layout.tiles[1].y, 10);
    assert.equal(layout.tiles[0].label.y, layout.tiles[1].label.y);
    assert.equal(layout.tiles[0].label.y, 10 + 200);
  });

  it("breaks rows at the column count and stacks them by their own heights", () => {
    const layout = layOutCollage(
      [size(100, 100), size(100, 100), size(100, 300)],
      style({ columns: 2 })
    );

    assert.equal(layout.rowCount, 2);
    // Row 1 is 100 + 54 tall, then a gap, then row 2 of 300 + 54 — two strips at 10% of the 538
    // the page comes to.
    assert.equal(layout.height, 100 + 54 + 10 + 300 + 54 + 10 * 2);
    assert.equal(layout.tiles[2].y, 10 + 100 + 54 + 10);
  });

  it("centres a partly filled row against the widest row", () => {
    const layout = layOutCollage(
      [size(100, 100), size(100, 100), size(100, 100)],
      style({ columns: 2 })
    );

    const widest = 100 + 10 + 100;
    assert.equal(layout.width, widest + 10 * 2);
    // The lone tile of the last row is centred, not left-aligned.
    assert.equal(layout.tiles[2].x, 10 + Math.round((widest - 100) / 2));
    assert.equal(layout.tiles[0].x, 10);
  });

  it("reserves nothing when gap and label strip are zero", () => {
    const layout = layOutCollage(
      [size(100, 100), size(100, 100)],
      style({ gapPercent: 0, labelPercent: 0 })
    );

    assert.equal(layout.width, 200);
    assert.equal(layout.height, 100);
    assert.deepEqual(
      layout.tiles.map((t) => t.x),
      [0, 100]
    );
    assert.equal(layout.tiles[0].label.height, 0);
  });

  it("gives a tall scan and a wide detail crop the same strip share (#337)", () => {
    // The bug this rule exists for: both go up as one listing, both are scaled to the platform's
    // limit, so a strip taken off the stamp left the crop's caption a third of the size of the
    // scan's. A share of the longest edge is the same on both.
    const share = (layout: { labelStripHeight: number; width: number; height: number }) =>
      layout.labelStripHeight / Math.max(layout.width, layout.height);

    const scan = layOutCollage([size(1500, 1900)], style({ columns: 1 }));
    const crop = layOutCollage([size(2000, 700)], style({ columns: 1 }));

    assert.ok(Math.abs(share(scan) - 0.1) < 0.005, `scan strip is ${share(scan)} of the image`);
    assert.ok(Math.abs(share(crop) - 0.1) < 0.005, `crop strip is ${share(crop)} of the image`);
  });

  it("refuses to spend more than half the page on strips, however many rows", () => {
    // 20% each is a fair ask on one row and an impossible one on ten; the layout has to stay
    // solvable rather than trust the number.
    const tiles = Array.from({ length: 10 }, () => size(100, 100));
    const layout = layOutCollage(tiles, style({ columns: 1, labelPercent: 20 }));

    assert.equal(layout.rowCount, 10);
    assert.ok(
      layout.labelStripHeight * 10 <= layout.height / 2,
      `${layout.labelStripHeight} × 10 is more than half of ${layout.height}`
    );
  });

  it("returns an empty canvas for no tiles", () => {
    assert.deepEqual(layOutCollage([], style()), {
      width: 0,
      height: 0,
      gap: 0,
      labelStripHeight: 0,
      referenceHeight: 0,
      tiles: [],
      rowCount: 0,
    });
  });
});
