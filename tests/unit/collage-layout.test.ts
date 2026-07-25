import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layOutCollage, type CollageTileSize } from "../../src/lib/collage-layout";

const size = (width: number, height: number): CollageTileSize => ({ width, height });

/** 10% and 20% of the stamp — with 100-tall tiles that is 10 px of gap and a 20 px strip, which is
 * what most of these cases are written against. */
const style = (over: Partial<{ columns: number; gapPercent: number; labelPercent: number }> = {}) => ({
  columns: 2,
  gapPercent: 10,
  labelPercent: 20,
  ...over,
});

describe("layOutCollage", () => {
  it("packs a single tile as a 1×1 collage with margin and label strip", () => {
    // One 140-tall tile: the percentages resolve against it, so gap 14 and strip 28.
    const layout = layOutCollage([size(100, 140)], style({ columns: 3 }));

    assert.equal(layout.rowCount, 1);
    assert.equal(layout.referenceHeight, 140);
    assert.equal(layout.gap, 14);
    assert.equal(layout.labelStripHeight, 28);
    assert.equal(layout.width, 100 + 14 * 2);
    assert.equal(layout.height, 140 + 28 + 14 * 2);
    assert.deepEqual(layout.tiles[0], {
      x: 14,
      y: 14,
      width: 100,
      height: 140,
      label: { x: 14, y: 154, width: 100, height: 28 },
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

  it("takes the percentages of the median tile, not the tallest", () => {
    // One souvenir sheet among four ordinary stamps must not inflate the whole page's strips.
    const layout = layOutCollage(
      [size(100, 100), size(100, 100), size(100, 100), size(300, 900)],
      style({ columns: 4 })
    );

    assert.equal(layout.referenceHeight, 100);
    assert.equal(layout.gap, 10);
    assert.equal(layout.labelStripHeight, 20);
  });

  it("shrinks the canvas to the contents rather than to the template's capacity", () => {
    // Two tiles under a 4-column template: one row, no reserved empty cells.
    const layout = layOutCollage([size(100, 100), size(100, 100)], style({ columns: 4 }));

    assert.equal(layout.rowCount, 1);
    assert.equal(layout.width, 100 + 10 + 100 + 10 * 2);
    assert.equal(layout.height, 100 + 20 + 10 * 2);
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
    // Row 1 is 100 + 20 tall, then a gap, then row 2 of 300 + 20.
    assert.equal(layout.height, 100 + 20 + 10 + 300 + 20 + 10 * 2);
    assert.equal(layout.tiles[2].y, 10 + 100 + 20 + 10);
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
