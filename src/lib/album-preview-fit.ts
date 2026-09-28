// How large the album template's preview draws a sheet (#1453): the zoom, and the two ways of
// choosing it.
//
// The Page template dialog fills the window, and every rem it gains goes to the preview. "As large as
// the room allows" then has two answers, and on the landscape monitor the collector sits at they
// disagree: fitted **whole**, an A4 sheet is bounded by the height and on a 1080-line screen comes
// out narrower than the fixed column #978 drew; fitted to the **width**, it is larger than it ever
// was and scrolls, taking the foot of the page — and a footer's or a bottom margin's mark — out of
// view. Settled with the collector on 2026-09-28: both, chosen beside the preview, and remembered.
//
// Pure, so the unit suite can hold the arithmetic; the panel only measures its frame.

export type AlbumPreviewFit = "page" | "width";

export const ALBUM_PREVIEW_FITS: readonly { value: AlbumPreviewFit; label: string; title: string }[] = [
  { value: "page", label: "Whole page", title: "The whole sheet in view, as large as it fits" },
  { value: "width", label: "Page width", title: "As wide as the preview is, scrolling down the sheet" },
];

/** The whole page is the default: every mark on the sheet is in view without scrolling to it. */
export function asAlbumPreviewFit(value: string | null): AlbumPreviewFit {
  return value === "width" ? "width" : "page";
}

/** CSS millimetres to CSS pixels. The canvas renders the sheet in `mm` units, so this is the
 *  conversion between the room the frame has and the zoom that fills it. */
const PX_PER_MM = 96 / 25.4;

/** Never larger than life. A page smaller than the frame is shown at 1:1 rather than blown up —
 *  a sheet of paper at 140% is not a thing the collector will ever hold. */
export const ALBUM_PREVIEW_MAX_ZOOM = 1;

/** The sheet's own border and shadow, which the zoom has to leave room for or a page fitted exactly
 *  to the frame grows a scrollbar under itself. */
const SHEET_CHROME_PX = 4;

/**
 * The zoom a sheet is drawn at in a frame of `frameWidth` × `frameHeight` CSS pixels.
 *
 * The page's proportions are the canvas's own — it scales both sides by the one factor — so all this
 * decides is the factor: bounded by the width alone for `"width"`, by the width and the height for
 * `"page"`, and never past 1:1. A frame not yet measured draws at 1:1, as the panel did before it had
 * a frame to read.
 */
export function albumPreviewZoom({
  fit,
  frameWidth,
  frameHeight,
  pageWidthMm,
  pageHeightMm,
}: {
  fit: AlbumPreviewFit;
  frameWidth: number;
  frameHeight: number;
  pageWidthMm: number;
  pageHeightMm: number;
}): number {
  if (frameWidth <= 0 || pageWidthMm <= 0) return ALBUM_PREVIEW_MAX_ZOOM;
  const byWidth = (frameWidth - SHEET_CHROME_PX) / (pageWidthMm * PX_PER_MM);
  const byHeight =
    fit === "page" && frameHeight > 0 && pageHeightMm > 0
      ? (frameHeight - SHEET_CHROME_PX) / (pageHeightMm * PX_PER_MM)
      : Infinity;
  return Math.max(0, Math.min(ALBUM_PREVIEW_MAX_ZOOM, byWidth, byHeight));
}
