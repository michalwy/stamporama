import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { albumBoxOutline } from "../../src/lib/album-box-outline";
import type { AlbumRect } from "../../src/lib/album-layout";

// A box's printed outline lies inside the box (#1466): the stroke's outer edge is the box's size, so a
// hawid cut to the box covers it. Both renderers stroke what `albumBoxOutline` returns.

const BOX: AlbumRect = { xMm: 20, yMm: 40, widthMm: 30, heightMm: 24 };

/** The outer edge of a stroke centred on `rect` with the given weight. */
function outerEdge(rect: AlbumRect, weightMm: number): AlbumRect {
  return {
    xMm: rect.xMm - weightMm / 2,
    yMm: rect.yMm - weightMm / 2,
    widthMm: rect.widthMm + weightMm,
    heightMm: rect.heightMm + weightMm,
  };
}

function assertRectClose(actual: AlbumRect, expected: AlbumRect) {
  for (const key of ["xMm", "yMm", "widthMm", "heightMm"] as const) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} ≠ ${expected[key]}`);
  }
}

describe("albumBoxOutline", () => {
  for (const style of ["solid", "dashed", "dotted"] as const) {
    for (const weight of [0.1, 0.2, 0.5, 3, 10]) {
      it(`puts a ${style} ${weight} mm line's outer edge on the box`, () => {
        const outline = albumBoxOutline({ boxBorderStyle: style, boxBorderWidthMm: weight }, BOX);
        assert.ok(outline);
        assert.equal(outline.weightMm, weight);
        assertRectClose(outerEdge(outline.rect, outline.weightMm), BOX);
      });
    }
  }

  it("takes a heavy line's weight from the inside", () => {
    const outline = albumBoxOutline({ boxBorderStyle: "solid", boxBorderWidthMm: 4 }, BOX);
    assert.ok(outline);
    // The inside of the line: the box less the full weight on every side.
    assertRectClose(
      {
        xMm: outline.rect.xMm + 2,
        yMm: outline.rect.yMm + 2,
        widthMm: outline.rect.widthMm - 4,
        heightMm: outline.rect.heightMm - 4,
      },
      { xMm: 24, yMm: 44, widthMm: 22, heightMm: 16 }
    );
  });

  it("caps a line heavier than the box at a solid box, never larger than itself", () => {
    const small: AlbumRect = { xMm: 0, yMm: 0, widthMm: 8, heightMm: 6 };
    const outline = albumBoxOutline({ boxBorderStyle: "solid", boxBorderWidthMm: 10 }, small);
    assert.ok(outline);
    assert.equal(outline.weightMm, 3);
    assertRectClose(outerEdge(outline.rect, outline.weightMm), small);
  });

  it("draws nothing for `none` or a zero weight", () => {
    assert.equal(albumBoxOutline({ boxBorderStyle: "none", boxBorderWidthMm: 0.2 }, BOX), null);
    assert.equal(albumBoxOutline({ boxBorderStyle: "solid", boxBorderWidthMm: 0 }, BOX), null);
  });
});
