import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeBox } from "../../src/lib/scan-boxes";
import {
  MAX_SCALE,
  ZOOM_STEP,
  actualSizeViewport,
  clampOffsets,
  fitScale,
  fitViewport,
  isFitted,
  panBy,
  regionKey,
  regionOnSheet,
  regionRequest,
  toSheetPoint,
  visibleRegion,
  zoomBy,
  zoomTo,
} from "../../src/lib/scan-viewport";

// A 600 dpi stockbook card and the `view` derivative the editor actually displays: 2500 px capped
// from 7000, which is the threefold downscale this whole feature is about.
const CARD = { width: 7000, height: 5000, viewWidth: 2500 };
const SIZE = { width: 1200, height: 800 };

describe("fitViewport", () => {
  it("shows the whole card, centred", () => {
    const v = fitViewport(CARD, SIZE);
    assert.ok(v.scale * CARD.width <= SIZE.width);
    assert.ok(v.scale * CARD.height <= SIZE.height);
    // Centred on the axis with room to spare.
    assert.ok(Math.abs(v.offsetY - (SIZE.height - CARD.height * v.scale) / 2) < 1e-9);
    assert.ok(isFitted(v, CARD, SIZE));
  });

  it("re-fits to a resized window", () => {
    const narrow = fitViewport(CARD, { width: 600, height: 800 });
    const wide = fitViewport(CARD, SIZE);
    assert.ok(wide.scale > narrow.scale);
  });
});

describe("actualSizeViewport", () => {
  it("is one display pixel per sheet pixel, not per view pixel", () => {
    const v = actualSizeViewport(CARD, SIZE);
    assert.equal(v.scale, 1);
    // The distinction the control exists for: 1:1 of the *view* would be this much smaller.
    assert.ok(fitScale(CARD, SIZE) < CARD.viewWidth / CARD.width);
  });
});

describe("zoomTo", () => {
  it("keeps the sheet pixel under the cursor under the cursor", () => {
    const v = fitViewport(CARD, SIZE);
    const cursor = { x: 300, y: 220 };
    const before = toSheetPoint(v, cursor.x, cursor.y);
    const after = toSheetPoint(zoomBy(v, 4, cursor, CARD, SIZE), cursor.x, cursor.y);
    assert.ok(Math.abs(after.x - before.x) < 1e-6);
    assert.ok(Math.abs(after.y - before.y) < 1e-6);
  });

  it("is reversible — zoom in and back out returns the same view", () => {
    const v = fitViewport(CARD, SIZE);
    const cursor = { x: 900, y: 140 };
    const round = zoomBy(zoomBy(v, ZOOM_STEP, cursor, CARD, SIZE), 1 / ZOOM_STEP, cursor, CARD, SIZE);
    assert.ok(Math.abs(round.scale - v.scale) < 1e-9);
    assert.ok(Math.abs(round.offsetX - v.offsetX) < 1e-6);
  });

  it("stops at the ceiling rather than magnifying paper fibres", () => {
    const v = zoomTo(fitViewport(CARD, SIZE), 1000, { x: 0, y: 0 }, CARD, SIZE);
    assert.equal(v.scale, MAX_SCALE);
  });

  it("will not zoom out past half of fit, which would only make the card smaller", () => {
    const fit = fitScale(CARD, SIZE);
    const v = zoomTo(fitViewport(CARD, SIZE), fit / 100, { x: 0, y: 0 }, CARD, SIZE);
    assert.ok(Math.abs(v.scale - fit / 2) < 1e-9);
  });
});

describe("clampOffsets", () => {
  it("centres an axis where the card is smaller than the viewport", () => {
    const v = clampOffsets({ scale: 0.1, offsetX: -5000, offsetY: 0 }, CARD, SIZE);
    assert.equal(v.offsetX, (SIZE.width - CARD.width * 0.1) / 2);
  });

  it("stops a zoomed card at its own edge instead of letting it leave the screen", () => {
    const zoomed = { scale: 1, offsetX: 0, offsetY: 0 };
    assert.equal(panBy(zoomed, 500, 0, CARD, SIZE).offsetX, 0);
    assert.equal(
      panBy(zoomed, -100000, 0, CARD, SIZE).offsetX,
      SIZE.width - CARD.width
    );
  });
});

describe("regionRequest", () => {
  it("asks for nothing while the view derivative still has the pixels", () => {
    assert.equal(regionRequest(fitViewport(CARD, SIZE), CARD, SIZE), null);
    // Exactly at the view's own scale the browser is not upscaling yet.
    const atView = zoomTo(
      fitViewport(CARD, SIZE),
      CARD.viewWidth / CARD.width,
      { x: 0, y: 0 },
      CARD,
      SIZE
    );
    assert.equal(regionRequest(atView, CARD, SIZE), null);
  });

  it("asks for the visible crop of the original past that point", () => {
    const v = zoomTo(fitViewport(CARD, SIZE), 1, { x: 600, y: 400 }, CARD, SIZE);
    const r = regionRequest(v, CARD, SIZE);
    assert.ok(r);
    // Whole sheet pixels, inside the card, and covering what is on screen.
    for (const n of [r.box.x, r.box.y, r.box.w, r.box.h]) assert.ok(Number.isInteger(n));
    assert.ok(r.box.x >= 0 && r.box.y >= 0);
    assert.ok(r.box.x + r.box.w <= CARD.width);
    assert.ok(r.box.y + r.box.h <= CARD.height);
    const topLeft = toSheetPoint(v, 0, 0);
    assert.ok(r.box.x <= topLeft.x && r.box.y <= topLeft.y);
  });

  it("does not render more pixels than the screen can show, nor more than the pipeline's cap", () => {
    const v = zoomTo(fitViewport(CARD, SIZE), MAX_SCALE, { x: 600, y: 400 }, CARD, SIZE);
    const r = regionRequest(v, CARD, SIZE, 2);
    assert.ok(r);
    assert.ok(r.renderWidth <= 2500);
    assert.ok(r.renderWidth <= r.box.w);
  });

  it("a HiDPI screen at fit still asks for nothing — dpr sizes a crop, it does not call for one", () => {
    assert.equal(regionRequest(fitViewport(CARD, SIZE), CARD, SIZE, 3), null);
  });

  it("snaps to a grid, so a small pan reuses the crop already fetched", () => {
    const v = zoomTo(fitViewport(CARD, SIZE), 2, { x: 600, y: 400 }, CARD, SIZE);
    const a = regionRequest(v, CARD, SIZE);
    const b = regionRequest(panBy(v, -3, -2, CARD, SIZE), CARD, SIZE);
    assert.ok(a && b);
    assert.equal(regionKey(a), regionKey(b));
  });
});

// A tile is a second picture over the same machinery (#585): the picture is the tile's crop of the
// card, and its derivative is the tile's own `full` photo.
const TILE_BOX = { x: 1280, y: 768, w: 1400, h: 1600 };
const TILE_SIZE = { width: 900, height: 700 };

describe("regionRequest over a picture that is not a downscale", () => {
  it("asks for nothing at any zoom", () => {
    // The ordinary single stamp at 1200 dpi: ~1400 px, under `FULL_MAX_EDGE`, so the tile photo
    // already carries every pixel the scan has of it. A region could only re-send them, at the
    // price of a full decode of a 30 Mpx original.
    const tile = { width: TILE_BOX.w, height: TILE_BOX.h, viewWidth: TILE_BOX.w };
    for (const scale of [0.5, 1, 3, MAX_SCALE]) {
      const v = zoomTo(fitViewport(tile, TILE_SIZE), scale, { x: 450, y: 350 }, tile, TILE_SIZE);
      assert.equal(regionRequest(v, tile, TILE_SIZE, 2), null, `at scale ${scale}`);
    }
  });

  it("still asks once the picture is capped — a block wider than the cap", () => {
    const block = { width: 4200, height: 2600, viewWidth: 2500 };
    const v = zoomTo(fitViewport(block, TILE_SIZE), 1, { x: 450, y: 350 }, block, TILE_SIZE);
    assert.ok(regionRequest(v, block, TILE_SIZE));
  });
});

describe("visibleRegion", () => {
  const PICTURE = { width: 1400, height: 1000 };

  it("covers what is on screen, with margin, snapped out to the grid", () => {
    const v = zoomTo(fitViewport(PICTURE, SIZE), 4, { x: 600, y: 400 }, PICTURE, SIZE);
    const box = visibleRegion(v, PICTURE, SIZE, 0.25, 64);
    assert.ok(box);
    const left = toSheetPoint(v, 0, 0);
    const right = toSheetPoint(v, SIZE.width, SIZE.height);
    assert.ok(box.x <= left.x && box.y <= left.y, "the visible corner is inside the region");
    assert.ok(box.x + box.w >= right.x && box.y + box.h >= right.y, "and so is the far one");
    for (const n of [box.x, box.y]) assert.equal(n % 64, 0, `${n} sits on the grid`);
  });

  it("gives a pan of a few pixels the same region", () => {
    const v = zoomTo(fitViewport(PICTURE, SIZE), 4, { x: 600, y: 400 }, PICTURE, SIZE);
    const moved = panBy(v, 3, -2, PICTURE, SIZE);
    assert.deepEqual(visibleRegion(moved, PICTURE, SIZE, 0.25, 64), visibleRegion(v, PICTURE, SIZE, 0.25, 64));
  });

  it("never leaves the picture", () => {
    const v = fitViewport(PICTURE, SIZE);
    const box = visibleRegion(v, PICTURE, SIZE, 1, 64);
    assert.deepEqual(box, { x: 0, y: 0, w: PICTURE.width, h: PICTURE.height });
  });

  it("is null before the picture or the viewport has a size", () => {
    const v = { scale: 1, offsetX: 0, offsetY: 0 };
    assert.equal(visibleRegion(v, { width: 0, height: 0 }, SIZE, 0.25, 64), null);
    assert.equal(visibleRegion(v, PICTURE, { width: 0, height: 0 }, 0.25, 64), null);
  });
});

describe("regionOnSheet", () => {
  it("re-addresses a picture's crop to the sheet it was taken from", () => {
    const block = { width: TILE_BOX.w, height: TILE_BOX.h, viewWidth: 700 };
    const v = zoomTo(fitViewport(block, TILE_SIZE), 2, { x: 450, y: 350 }, block, TILE_SIZE);
    const r = regionRequest(v, block, TILE_SIZE);
    assert.ok(r);
    const onSheet = regionOnSheet(r, { x: TILE_BOX.x, y: TILE_BOX.y });
    assert.equal(onSheet.box.x, r.box.x + TILE_BOX.x);
    assert.equal(onSheet.box.y, r.box.y + TILE_BOX.y);
    // The crop keeps its size and how large it is rendered — only where it is changes.
    assert.equal(onSheet.box.w, r.box.w);
    assert.equal(onSheet.box.h, r.box.h);
    assert.equal(onSheet.renderWidth, r.renderWidth);
    // And it lands inside the tile's own rectangle of the card, never beside it.
    assert.ok(onSheet.box.x + onSheet.box.w <= TILE_BOX.x + TILE_BOX.w);
    assert.ok(onSheet.box.y + onSheet.box.h <= TILE_BOX.y + TILE_BOX.h);
  });

  it("is the identity for a picture that is the whole sheet", () => {
    const v = zoomTo(fitViewport(CARD, SIZE), 1, { x: 600, y: 400 }, CARD, SIZE);
    const r = regionRequest(v, CARD, SIZE);
    assert.ok(r);
    assert.deepEqual(regionOnSheet(r, { x: 0, y: 0 }), r);
  });
});

describe("zoom cannot perturb what is stored", () => {
  it("a box drawn at any zoom is whole sheet pixels", () => {
    // The editor's own path: two pointer positions → fractional sheet points → `normalizeBox`.
    for (const scale of [0.13, 0.357, 1, 1.7, MAX_SCALE]) {
      const v = zoomTo(fitViewport(CARD, SIZE), scale, { x: 517, y: 301 }, CARD, SIZE);
      const a = toSheetPoint(v, 133.7, 201.9);
      const b = toSheetPoint(v, 421.3, 555.1);
      const box = normalizeBox({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, CARD);
      assert.ok(box, `expected a box at scale ${scale}`);
      for (const n of [box.x, box.y, box.w, box.h]) {
        assert.ok(Number.isInteger(n), `${n} is not a whole pixel at scale ${scale}`);
      }
      assert.ok(box.x + box.w <= CARD.width && box.y + box.h <= CARD.height);
    }
  });
});
