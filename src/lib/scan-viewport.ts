// Zoom and pan for the cut editor (#579, ADR-0033 §6): the view transform between a sheet's
// pixels and the pixels on screen, and the region of the original that the transform makes worth
// fetching.
//
// Pure — no DOM, no React, no Prisma. It lives beside `scan-boxes.ts` rather than inside the editor
// for the reason that module gives: the editor is a client component, the region route is a server
// one, and the arithmetic that decides *which crop of the original the screen is showing* has to be
// the same number on both sides of that line. A unit test can hold it here and nowhere else.
//
// The one invariant this module exists to protect: **zoom is a view transform and changes nothing
// that is stored**. Boxes are whole sheet pixels at every zoom (`scan-boxes.ts`), so every function
// here converts *towards* the screen, and the single function converting back
// ({@link toSheetPoint}) hands its result to `normalizeBox`, which rounds. There is deliberately no
// function here that produces a `Box`.

import type { Box, SheetSize } from "./scan-boxes";

/** The view transform: `scale` display pixels per sheet pixel, and where the sheet's top-left
 * corner sits inside the viewport, in display pixels. */
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** The viewport element's size in CSS pixels. */
export interface ViewportSize {
  width: number;
  height: number;
}

/** Hard ceiling on zoom, in display pixels per sheet pixel. Past roughly this there is nothing
 * further to see even in the original: a 600 dpi scan magnified eightfold is already showing
 * individual paper fibres. */
export const MAX_SCALE = 8;

/** Floor, as a multiple of the fit scale. Zooming *out* past fit exists so a card can be seen whole
 * with room to spare while dragging a box near its edge; it is not a second way to see less. */
export const MIN_FIT_MULTIPLE = 0.5;

/** One press of `+` / `−` or of a zoom control. A little under √2, so two presses are a touch under
 * a doubling and the steps land on recognisable scales rather than on 1.0 exactly once. */
export const ZOOM_STEP = 1.35;

/** Padding kept between the card and the viewport's edges at fit, in display pixels. */
const FIT_PADDING = 16;

/** Display pixels per sheet pixel at which the whole card fits with {@link FIT_PADDING} to spare. */
export function fitScale(sheet: SheetSize, size: ViewportSize): number {
  const w = Math.max(1, size.width - FIT_PADDING * 2);
  const h = Math.max(1, size.height - FIT_PADDING * 2);
  if (sheet.width <= 0 || sheet.height <= 0) return 1;
  return Math.min(w / sheet.width, h / sheet.height);
}

/** The card centred and whole — the editor's default, and what `0` returns to. */
export function fitViewport(sheet: SheetSize, size: ViewportSize): Viewport {
  const scale = fitScale(sheet, size);
  return clampOffsets({ scale, offsetX: 0, offsetY: 0 }, sheet, size);
}

/** One screen pixel per **sheet** pixel — never per *view* pixel. The editor displays a derivative
 * capped at 2500 px while a 600 dpi card is around 7000, so a control that meant one view pixel
 * would read `1:1` while showing a threefold downscale: it would lie about the very thing it is
 * there for. */
export function actualSizeViewport(
  sheet: SheetSize,
  size: ViewportSize,
  anchor?: { x: number; y: number }
): Viewport {
  return zoomTo(fitViewport(sheet, size), 1, anchor ?? centerOf(size), sheet, size);
}

/** Whether a viewport is at fit, within a rounding tolerance — what keeps the **Fit** control lit
 * and, more importantly, what tells a resize whether to re-fit or to leave a chosen zoom alone. */
export function isFitted(v: Viewport, sheet: SheetSize, size: ViewportSize): boolean {
  return Math.abs(v.scale - fitScale(sheet, size)) < 1e-6;
}

/**
 * Zoom to a **point**, not to the centre.
 *
 * The sheet pixel under `anchor` stays under `anchor` afterwards. That is what makes the wheel
 * usable for the job this editor exists for: the collector puts the pointer on the perforation they
 * are suspicious of and turns the wheel, rather than zooming the middle of the card and then hunting
 * for the stamp again.
 */
export function zoomTo(
  v: Viewport,
  scale: number,
  anchor: { x: number; y: number },
  sheet: SheetSize,
  size: ViewportSize
): Viewport {
  const next = clampScale(scale, sheet, size);
  if (next === v.scale) return v;
  // The sheet point under the anchor, held fixed across the change.
  const sx = (anchor.x - v.offsetX) / v.scale;
  const sy = (anchor.y - v.offsetY) / v.scale;
  return clampOffsets(
    { scale: next, offsetX: anchor.x - sx * next, offsetY: anchor.y - sy * next },
    sheet,
    size
  );
}

/** Zoom by a factor about a point — what one wheel notch, one `+`, one control press does. */
export function zoomBy(
  v: Viewport,
  factor: number,
  anchor: { x: number; y: number },
  sheet: SheetSize,
  size: ViewportSize
): Viewport {
  return zoomTo(v, v.scale * factor, anchor, sheet, size);
}

/** Pan by a display-pixel delta. */
export function panBy(
  v: Viewport,
  dx: number,
  dy: number,
  sheet: SheetSize,
  size: ViewportSize
): Viewport {
  return clampOffsets({ ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }, sheet, size);
}

export function clampScale(scale: number, sheet: SheetSize, size: ViewportSize): number {
  const fit = fitScale(sheet, size);
  return clamp(scale, Math.min(fit * MIN_FIT_MULTIPLE, fit), MAX_SCALE);
}

/**
 * Keep the card in the viewport: centred on an axis where it is smaller than the viewport, and
 * otherwise stopped at its own edge.
 *
 * Without this a card can be dragged off screen entirely, which on a surface with no scrollbars —
 * this one owns the wheel — is a state with no way back except **Fit**.
 */
export function clampOffsets(v: Viewport, sheet: SheetSize, size: ViewportSize): Viewport {
  return {
    scale: v.scale,
    offsetX: clampAxis(v.offsetX, sheet.width * v.scale, size.width),
    offsetY: clampAxis(v.offsetY, sheet.height * v.scale, size.height),
  };
}

function clampAxis(offset: number, content: number, viewport: number): number {
  if (content <= viewport) return (viewport - content) / 2;
  return clamp(offset, viewport - content, 0);
}

/** A point in the viewport's own coordinates, as a **fractional** sheet coordinate. Fractional on
 * purpose: rounding belongs to `normalizeBox`, which is the one place that knows whether the number
 * is about to become a stored edge. */
export function toSheetPoint(v: Viewport, x: number, y: number): { x: number; y: number } {
  if (v.scale <= 0) return { x: 0, y: 0 };
  return { x: (x - v.offsetX) / v.scale, y: (y - v.offsetY) / v.scale };
}

// ── What to fetch from the original ───────────────────────────────────────────────────────────

/** Region requests are snapped out to a grid of this many sheet pixels, so a pan of a few pixels
 * asks for the same crop as the pan before it. Without it, panning at high zoom would ask the route
 * for a new nearly-identical crop on every frame — and each one costs a full decode of a 30 Mpx
 * original server-side. */
const REGION_GRID_PX = 128;

/** How much beyond the visible edges to fetch, as a fraction of the visible region. A small pan
 * then lands inside a crop that is already on screen. */
const REGION_MARGIN = 0.25;

/** A crop of the original to display over the `view` derivative. */
export interface RegionRequest {
  /** Where on the sheet, in whole sheet pixels. */
  box: Box;
  /** Width to render it at, in image pixels — enough for the screen and no more. */
  renderWidth: number;
}

/**
 * The crop of the original worth fetching for what is currently on screen, or null when the `view`
 * derivative is still the better answer.
 *
 * **Null below the view's own scale.** The editor shows `view`, capped at `FULL_MAX_EDGE`; while
 * one display pixel covers a whole view pixel or more, the view is showing every pixel the screen
 * can and the original would only send more bytes for the same picture. Past that point the browser
 * is upscaling — magnifying a threefold downscale rather than showing more stamp — and that is
 * precisely where the retained original earns its keep.
 *
 * `dpr` is the display's device-pixel ratio and affects only how large the crop is rendered, never
 * whether one is fetched: a HiDPI screen at fit is the ordinary case and must not turn into a
 * full-card crop request.
 */
export function regionRequest(
  v: Viewport,
  sheet: SheetSize & { viewWidth: number },
  size: ViewportSize,
  dpr = 1,
  maxRenderWidth = 2500
): RegionRequest | null {
  if (sheet.width <= 0 || sheet.height <= 0 || size.width <= 0 || size.height <= 0) return null;
  const viewScale = sheet.viewWidth / sheet.width;
  if (v.scale <= viewScale) return null;

  // The visible rectangle in sheet pixels, grown by a margin and snapped out to the grid.
  const left = toSheetPoint(v, 0, 0);
  const right = toSheetPoint(v, size.width, size.height);
  const marginX = (right.x - left.x) * REGION_MARGIN;
  const marginY = (right.y - left.y) * REGION_MARGIN;

  const x = snapDown(left.x - marginX, sheet.width);
  const y = snapDown(left.y - marginY, sheet.height);
  const x1 = snapUp(right.x + marginX, sheet.width);
  const y1 = snapUp(right.y + marginY, sheet.height);

  const box: Box = { x, y, w: x1 - x, h: y1 - y };
  if (box.w <= 0 || box.h <= 0) return null;

  // Rendered for the pixels the screen actually has, capped so a request can never ask for more
  // than the pipeline's own ceiling however far the zoom is pushed.
  const renderWidth = Math.min(
    box.w,
    maxRenderWidth,
    Math.max(1, Math.ceil(box.w * v.scale * dpr))
  );
  return { box, renderWidth };
}

/** A stable key for a request — what the editor caches on and what the route's URL is built from,
 * so two viewports that resolve to the same crop share one fetch. */
export function regionKey(r: RegionRequest): string {
  return `${r.box.x},${r.box.y},${r.box.w},${r.box.h}@${r.renderWidth}`;
}

function snapDown(n: number, limit: number): number {
  return clamp(Math.floor(n / REGION_GRID_PX) * REGION_GRID_PX, 0, limit);
}

function snapUp(n: number, limit: number): number {
  return clamp(Math.ceil(n / REGION_GRID_PX) * REGION_GRID_PX, 0, limit);
}

function centerOf(size: ViewportSize): { x: number; y: number } {
  return { x: size.width / 2, y: size.height / 2 };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
