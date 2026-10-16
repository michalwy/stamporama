import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { THUMB_MAX_EDGE } from "../../src/lib/photos/process";
import { ROW_CHIP } from "../../src/app/c/[collectionSlug]/shared/chip-styles";
import {
  DEFAULT_SCAN_TILE_SIZE,
  SCAN_TILE_CHROME,
  SCAN_TILE_SIZES,
  SCAN_TILE_WIDTH_REM,
  parseScanTileSize,
} from "../../src/lib/scan-tile-size";

describe("scan tile size (#1922)", () => {
  it("defaults to medium, about twice the old 5.5 rem square", () => {
    assert.equal(DEFAULT_SCAN_TILE_SIZE, "medium");
    assert.equal(SCAN_TILE_WIDTH_REM.medium, 2 * SCAN_TILE_WIDTH_REM.small);
    assert.equal(SCAN_TILE_WIDTH_REM.small, 5.5);
  });

  it("reads back every size it stores", () => {
    for (const size of SCAN_TILE_SIZES) assert.equal(parseScanTileSize(size), size);
  });

  it("falls back to the default for anything it cannot read", () => {
    assert.equal(parseScanTileSize(null), "medium");
    assert.equal(parseScanTileSize(undefined), "medium");
    assert.equal(parseScanTileSize(""), "medium");
    assert.equal(parseScanTileSize("huge"), "medium");
  });

  it("orders the sizes small to large", () => {
    const widths = SCAN_TILE_SIZES.map((s) => SCAN_TILE_WIDTH_REM[s]);
    assert.deepEqual(
      widths,
      [...widths].sort((a, b) => a - b),
    );
  });

  it("stops Large below the thumbnail's own long edge, so it never just enlarges pixels", () => {
    assert.ok(SCAN_TILE_WIDTH_REM.large * 16 <= THUMB_MAX_EDGE);
  });
});

describe("scan tile chrome (#1971)", () => {
  const rem = (v: unknown) => Number.parseFloat(String(v));

  it("sets the smallest tile's condition mark no smaller than a list row's condition chip", () => {
    for (const size of SCAN_TILE_SIZES) {
      assert.ok(SCAN_TILE_CHROME[size].markFontRem >= rem(ROW_CHIP.fontSize), size);
    }
    assert.equal(SCAN_TILE_CHROME.small.markFontRem, rem(ROW_CHIP.fontSize));
  });

  it("grows every mark with the tile, never shrinking one", () => {
    const keys = ["bandRem", "boxRem", "markFontRem", "labelFontRem"] as const;
    for (const key of keys) {
      const steps = SCAN_TILE_SIZES.map((s) => SCAN_TILE_CHROME[s][key]);
      assert.deepEqual(steps, [...steps].sort((a, b) => a - b), key);
    }
  });

  it("keeps the corner marks inside the band, so they sit on the frame and not on the stamp", () => {
    for (const size of SCAN_TILE_SIZES) {
      const c = SCAN_TILE_CHROME[size];
      assert.ok(c.boxRem + 2 * c.insetRem <= c.bandRem + 1e-9, size);
    }
  });

  it("leaves the mark room between the two corners at every size", () => {
    for (const size of SCAN_TILE_SIZES) {
      const c = SCAN_TILE_CHROME[size];
      // Both corners reserved (a parked tile wears the badge and the box), less the 2 px frame.
      const between = SCAN_TILE_WIDTH_REM[size] - 2 * (c.boxRem + 2 * c.insetRem) - 0.25;
      // An abbreviation of three letters, about 0.6 em each, and the chip's own padding.
      assert.ok(between >= 3 * 0.6 * c.markFontRem + 0.6, size);
    }
  });
});
