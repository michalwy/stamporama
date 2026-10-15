import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { THUMB_MAX_EDGE } from "../../src/lib/photos/process";
import {
  DEFAULT_SCAN_TILE_SIZE,
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
