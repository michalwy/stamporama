import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_PREVIEW_MAX_ZOOM,
  albumPreviewZoom,
  asAlbumPreviewFit,
} from "../../src/lib/album-preview-fit";

// A4, in CSS pixels at 1:1: 210 mm and 297 mm at 96 px to the inch.
const A4 = { pageWidthMm: 210, pageHeightMm: 297 };
const A4_WIDTH_PX = (210 * 96) / 25.4;
const A4_HEIGHT_PX = (297 * 96) / 25.4;
const CHROME = 4;
/** Floating-point room for a sheet fitted exactly to its bound. */
const EPS = 1e-9;

describe("albumPreviewZoom (#1453)", () => {
  it("fits the whole page inside a frame shorter than the page is tall", () => {
    // A landscape window: the width would allow more, the height bounds it.
    const zoom = albumPreviewZoom({ fit: "page", frameWidth: 990, frameHeight: 740, ...A4 });
    assert.equal(zoom, (740 - CHROME) / A4_HEIGHT_PX);
    assert.ok(A4_HEIGHT_PX * zoom + CHROME <= 740 + EPS);
    assert.ok(A4_WIDTH_PX * zoom + CHROME <= 990 + EPS);
  });

  it("fits the page width when asked, whatever the frame's height", () => {
    const zoom = albumPreviewZoom({ fit: "width", frameWidth: 600, frameHeight: 400, ...A4 });
    assert.equal(zoom, (600 - CHROME) / A4_WIDTH_PX);
    assert.ok(A4_HEIGHT_PX * zoom > 400, "the sheet is taller than the frame and scrolls");
  });

  it("fits the whole page by the width when the frame is the narrower bound", () => {
    const zoom = albumPreviewZoom({ fit: "page", frameWidth: 400, frameHeight: 2000, ...A4 });
    assert.equal(zoom, (400 - CHROME) / A4_WIDTH_PX);
  });

  it("keeps the page's proportions: one factor for both sides, the larger of the two fits", () => {
    const page = albumPreviewZoom({ fit: "page", frameWidth: 990, frameHeight: 740, ...A4 });
    const width = albumPreviewZoom({ fit: "width", frameWidth: 990, frameHeight: 740, ...A4 });
    assert.ok(width > page);
  });

  it("never draws larger than life", () => {
    for (const fit of ["page", "width"] as const) {
      assert.equal(
        albumPreviewZoom({ fit, frameWidth: 3000, frameHeight: 3000, ...A4 }),
        ALBUM_PREVIEW_MAX_ZOOM
      );
    }
  });

  it("draws at 1:1 before the frame has been measured or a page planned", () => {
    assert.equal(albumPreviewZoom({ fit: "page", frameWidth: 0, frameHeight: 0, ...A4 }), 1);
    assert.equal(
      albumPreviewZoom({ fit: "page", frameWidth: 500, frameHeight: 500, pageWidthMm: 0, pageHeightMm: 0 }),
      1
    );
  });

  it("falls back to the width when the frame's height is not known yet", () => {
    assert.equal(
      albumPreviewZoom({ fit: "page", frameWidth: 600, frameHeight: 0, ...A4 }),
      (600 - CHROME) / A4_WIDTH_PX
    );
  });

  it("never goes negative in a frame smaller than the sheet's own border", () => {
    assert.equal(albumPreviewZoom({ fit: "page", frameWidth: 2, frameHeight: 2, ...A4 }), 0);
  });
});

describe("asAlbumPreviewFit", () => {
  it("defaults to the whole page, and reads back what was stored", () => {
    assert.equal(asAlbumPreviewFit(null), "page");
    assert.equal(asAlbumPreviewFit("nonsense"), "page");
    assert.equal(asAlbumPreviewFit("page"), "page");
    assert.equal(asAlbumPreviewFit("width"), "width");
  });
});
