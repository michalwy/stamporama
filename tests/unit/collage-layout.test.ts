import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layOutCollage, type CollageTileSize } from "../../src/lib/collage-layout";

const size = (width: number, height: number): CollageTileSize => ({ width, height });

const style = (over: Partial<{ columns: number; gap: number; labelStripHeight: number }> = {}) => ({
  columns: 2,
  gap: 10,
  labelStripHeight: 20,
  ...over,
});

describe("layOutCollage", () => {
  it("packs a single tile as a 1×1 collage with margin and label strip", () => {
    const layout = layOutCollage([size(100, 140)], style({ columns: 3 }));

    assert.equal(layout.rowCount, 1);
    assert.equal(layout.width, 100 + 10 * 2);
    assert.equal(layout.height, 140 + 20 + 10 * 2);
    assert.deepEqual(layout.tiles[0], {
      x: 10,
      y: 10,
      width: 100,
      height: 140,
      label: { x: 10, y: 150, width: 100, height: 20 },
    });
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
      style({ gap: 0, labelStripHeight: 0 })
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
      tiles: [],
      rowCount: 0,
    });
  });
});
