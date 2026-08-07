import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  layOutCollage,
  resolveCollageColumns,
  trueScaledSizes,
  trueSizeScales,
  type CollageTileSize,
  type CollageTileTrueSize,
} from "../../src/lib/collage-layout";

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

describe("trueSizeScales", () => {
  const tile = (
    stored: [number, number],
    original: [number, number] | null
  ): CollageTileTrueSize => ({
    stored: size(stored[0], stored[1]),
    original: original ? size(original[0], original[1]) : null,
  });

  it("leaves every tile alone when nothing was downscaled", () => {
    assert.deepEqual(
      trueSizeScales([tile([100, 140], [100, 140]), tile([200, 140], [200, 140])]),
      [1, 1]
    );
  });

  it("puts a clamped scan and an untouched one back on a common scale", () => {
    // Both scanned at the same DPI: the second block is physically twice the first. The upload cap
    // shrank it to the same stored size, so the smaller one has to give the difference back.
    const [small, large] = trueSizeScales([
      tile([2500, 2000], [2500, 2000]),
      tile([2500, 2000], [5000, 4000]),
    ]);
    assert.equal(large, 1);
    assert.equal(small, 0.5);
  });

  it("never scales a tile up — the worst-shrunk tile keeps its pixels", () => {
    const scales = trueSizeScales([
      tile([2500, 2500], [10000, 10000]),
      tile([2500, 2500], [5000, 5000]),
      tile([1000, 1000], [1000, 1000]),
    ]);
    // The 4×-shrunk tile sets the common scale, so the untouched 1000 px tile lands at a quarter —
    // 2500:250, the 10:1 its 10000:1000 originals call for.
    assert.deepEqual(scales, [1, 0.5, 0.25]);
    assert.ok(scales.every((s) => s <= 1));
  });

  it("reads a photo with no recorded original as never downscaled", () => {
    // Pre-migration rows: the original bytes are gone, so `r = 1` and the pair behaves exactly as
    // it did before the originals were recorded.
    assert.deepEqual(trueSizeScales([tile([2500, 2000], null), tile([1200, 1000], null)]), [1, 1]);
  });

  it("ignores an original that is not larger than what was stored", () => {
    // `withoutEnlargement` means a small upload is stored at its native size; a recorded original
    // at or under the stored size is therefore not evidence of a downscale.
    assert.deepEqual(trueSizeScales([tile([800, 600], [800, 600]), tile([400, 300], [380, 285])]), [
      1, 1,
    ]);
  });

  it("returns nothing for no tiles", () => {
    assert.deepEqual(trueSizeScales([]), []);
  });
});

describe("resolveCollageColumns", () => {
  const auto = (rows: number, columns: number) =>
    ({ gridMode: "auto", rows, columns }) as const;

  /** `n` identical square tiles — the uniform collage every #413 case was written against. */
  const square = (n: number) => Array.from({ length: n }, () => ({ width: 100, height: 100 }));

  it("hands back the template's columns unchanged in fixed mode", () => {
    // The whole point of the fixed grid: what was typed is what every row is filled to, whatever
    // the tiles do.
    for (const count of [1, 2, 4, 5, 9]) {
      assert.equal(resolveCollageColumns(square(count), { gridMode: "fixed", rows: 5, columns: 4 }), 4);
    }
    // Not even sizes wildly out of proportion move it — that is what "fixed" means.
    assert.equal(
      resolveCollageColumns(
        [{ width: 1200, height: 200 }, { width: 100, height: 140 }],
        { gridMode: "fixed", rows: 5, columns: 4 }
      ),
      4
    );
  });

  it("shapes the grid from the tile count in auto mode", () => {
    // The cases the mode exists for: a template written for nine now lays four out 2 × 2 and five
    // out 3 + 2, instead of one lopsided 4 + 1 row.
    assert.equal(resolveCollageColumns(square(1), auto(3, 3)), 1);
    assert.equal(resolveCollageColumns(square(2), auto(3, 3)), 2);
    assert.equal(resolveCollageColumns(square(4), auto(3, 3)), 2);
    assert.equal(resolveCollageColumns(square(5), auto(3, 3)), 3);
    assert.equal(resolveCollageColumns(square(6), auto(3, 3)), 3);
    assert.equal(resolveCollageColumns(square(9), auto(3, 3)), 3);
  });

  it("never answers a one-tile column just because it wastes no cell", () => {
    // Empty area alone would: a single column is always perfectly full. The shape term is what
    // stops five stamps coming out as a strip nobody can read.
    assert.equal(resolveCollageColumns(square(5), auto(20, 20)), 3);
    assert.equal(resolveCollageColumns(square(7), auto(20, 20)), 3);
  });

  it("prefers a rectangle over a ragged near-square", () => {
    // Squareness alone would answer 3 + 3 + 3 + 1 here. Ten under a 4-wide bound is 4 + 4 + 2.
    assert.equal(resolveCollageColumns(square(10), auto(4, 4)), 4);
    assert.equal(resolveCollageColumns(square(12), auto(20, 20)), 4);
  });

  it("breaks a tie towards the wider grid", () => {
    // Six fits 3 × 2 and 2 × 3 equally well; text sits beside the image on a listing page, so the
    // shorter one wins.
    assert.equal(resolveCollageColumns(square(6), auto(20, 20)), 3);
  });

  it("stays inside both bounds", () => {
    // The row ceiling forces the row wider than the shape rule would like...
    assert.equal(resolveCollageColumns(square(9), auto(2, 8)), 5);
    // ...and the column ceiling caps it, even past capacity, which the grouping rules never produce.
    assert.equal(resolveCollageColumns(square(9), auto(2, 3)), 3);
    assert.equal(resolveCollageColumns(square(99), auto(2, 3)), 3);
  });

  it("never answers a row wider than the tile count", () => {
    // The canvas shrinks to its contents (#307), so the columns past the last tile cost nothing —
    // and would take every tie by being wider.
    assert.equal(resolveCollageColumns(square(3), auto(20, 20)), 2);
    assert.equal(resolveCollageColumns(square(1), auto(20, 20)), 1);
  });

  // ── #514: the sizes, not just the count ────────────────────────────────────

  it("reads the canvas a wide tile makes, not the cells it fills", () => {
    // Six wide detail crops: the count alone says 3 × 2, which here is a 1200 × 200 letterbox.
    // Measured, one on top of another is the balanced page — 400 × 600 — and a column is only a
    // strip nobody can read when the tiles are tall. Six portrait stamps still answer 3, as they
    // always did.
    const wide = Array.from({ length: 6 }, () => ({ width: 400, height: 100 }));
    const portrait = Array.from({ length: 6 }, () => ({ width: 100, height: 140 }));
    assert.equal(resolveCollageColumns(wide, auto(6, 6)), 1);
    assert.equal(resolveCollageColumns(portrait, auto(6, 6)), 3);
  });

  it("counts the space an outlier leaves beside its neighbours", () => {
    // One souvenir sheet among small definitives. Put three to a row and the sheet's row towers
    // over the other, leaving the short row stranded in the middle of a much wider canvas; two to a
    // row keeps the holes down.
    const mixed = [
      { width: 420, height: 300 },
      { width: 100, height: 130 },
      { width: 100, height: 130 },
      { width: 100, height: 130 },
    ];
    assert.equal(resolveCollageColumns(mixed, auto(3, 3)), 2);
  });

  it("is total: no tiles, a degenerate size or a degenerate bound still names a width", () => {
    assert.equal(resolveCollageColumns([], auto(3, 3)), 1);
    assert.equal(resolveCollageColumns(square(4), auto(0, 0)), 1);
    // A photo row with no recorded dimensions poisons every area it is measured with, so the whole
    // collage falls back to the uniform scoring #413 always used: four tiles land 2 × 2.
    assert.equal(
      resolveCollageColumns([...square(3), { width: 0, height: 0 }], auto(3, 3)),
      2
    );
  });
});

describe("trueScaledSizes", () => {
  it("leaves un-clamped scans at their stored size", () => {
    assert.deepEqual(
      trueScaledSizes([
        { stored: { width: 100, height: 140 }, original: null },
        { stored: { width: 200, height: 260 }, original: { width: 200, height: 260 } },
      ]),
      [
        { width: 100, height: 140 },
        { width: 200, height: 260 },
      ]
    );
  });

  it("puts a clamped scan back in proportion with the tile beside it", () => {
    // A sheet that arrived at 5000 px and was stored at 2500 is half the size it should be next to
    // a stamp that was never clamped — so the *stamp* comes down instead, and the sheet keeps its
    // pixels. Twice as wide in reality, twice as wide on the canvas.
    const [sheet, stamp] = trueScaledSizes([
      { stored: { width: 2500, height: 2000 }, original: { width: 5000, height: 4000 } },
      { stored: { width: 1250, height: 1000 }, original: null },
    ]);
    assert.deepEqual(sheet, { width: 2500, height: 2000 });
    assert.deepEqual(stamp, { width: 625, height: 500 });
  });
});
