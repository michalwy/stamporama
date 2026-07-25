/**
 * Pure text layout for the label strips of a collage (#312) — no `sharp`, so the fitting rules are
 * unit-testable on plain numbers, and the SVG the renderer composites is built by a function that
 * takes nothing but a layout and some strings.
 *
 * Why a label at all
 * ------------------
 * Every tile carries one, including the single-stamp case: a buyer writing "I'd like the one
 * labelled A234" has to identify a copy unambiguously, and the seller has to map that back to an
 * inventory item. The text comes from the offer's own label templates (#308), resolved per copy by
 * the title-template engine — usually `{ref}`, the copy's location ref. Because it is derived from
 * the copy's own data rather than from a position in the plan, it survives regeneration untouched.
 *
 * A tile carries **two** annotations, left and right, from two separate templates but sharing one
 * strip and one font size: the pair that is actually wanted is an identifier on one side and
 * something descriptive (a catalog number, a condition) on the other, and forcing both through one
 * template would only produce one long line that has to be shrunk to fit. A side left unconfigured
 * simply is not drawn, and a lone annotation is centred rather than left hanging off an edge.
 *
 * Why a strip below the tile
 * --------------------------
 * An overlay would hide part of the stamp and would be illegible over a dark scan. The strip is
 * reserved by the layout (#310, `labelStripHeight` from the collage template, #307) and painted in
 * the collage's own background colour, so the text is drawn on a flat, known surface — the ink
 * colour is picked from that background rather than guessed.
 *
 * Fitting
 * -------
 * Text is centred under its tile and scaled to fit the strip: capped by the strip's height, then by
 * the tile's width. Below a legibility floor the text is truncated with an ellipsis instead of
 * shrinking further — an unreadable label is worth no more than a shortened one. A copy whose
 * template tokens all came out empty simply gets an unlabelled tile; nothing is invented.
 *
 * Every size here is a **fraction of the strip it is drawn in**, and the strip is itself a fraction
 * of the stamp (#312) — there is no pixel constant anywhere in this module. That is what makes the
 * result independent of scan DPI and of the platform's downscale: the label keeps its size relative
 * to the stamp it names, whatever resolution the finished image ends up at.
 */

import type { CollageLayout } from "./collage-layout";

/** The font stack the strips are drawn in. DejaVu Sans is installed in the app image (see the
 * `Dockerfile`); the rest are fallbacks for a host that has something else. A generic `sans-serif`
 * last means a machine with no fonts at all still renders *something* rather than nothing. */
export const LABEL_FONT_FAMILY = "DejaVu Sans, Verdana, Arial, Helvetica, sans-serif";

/** Fraction of the strip's height the glyphs may occupy, leaving air above and below. */
const HEIGHT_RATIO = 0.78;
/** Fraction of the tile's width the text may occupy, so a label never touches its neighbour. */
const WIDTH_RATIO = 0.94;
/** Average glyph advance as a fraction of the font size, for the DejaVu-like stack above. Only an
 * estimate — measuring text would need the font — so it is deliberately generous: a label that
 * comes out a little small is fine, one that overflows its tile is not. */
const ADVANCE_RATIO = 0.62;
/** How far below the strip's own size the text may shrink to fit a long label before it is
 * truncated instead. A fraction, not a pixel count: what makes a label readable is its size next to
 * the stamp, and that ratio is the same at every scan resolution. Set low enough that a full
 * `Fi·PL 10 / Mi·PL 12` under a narrow stamp still reads whole — a third of the strip is still a
 * twentieth of the stamp beside it — because cutting a catalog number is worse than a smaller one. */
const MIN_HEIGHT_FRACTION = 0.35;
/** Where the baseline sits inside the strip: roughly the cap height of the stack above, used to
 * centre the glyphs vertically without relying on `dominant-baseline`, which renderers disagree on. */
const CAP_RATIO = 0.72;

/** A label fitted to one strip: what to draw, at what size. */
export interface FittedLabel {
  text: string;
  fontSize: number;
}

/** Collapse the whitespace a rendered template may carry into a single line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Fit one label into a `width × height` strip, or null when there is nothing to draw — a blank
 * label, a strip with no height (`labelStripHeight` of 0 reserves nothing), or a box too narrow for
 * even one glyph.
 */
export function fitCollageLabel(
  text: string,
  width: number,
  height: number
): FittedLabel | null {
  return fitToWidth(oneLine(text), width * WIDTH_RATIO, height);
}

/** {@link fitCollageLabel} against a width that is **already** the drawable one — what the two-sided
 * placement works in, having divided the strip between the annotations itself. `forced` draws at a
 * size decided elsewhere (the collage's shared size), fitting the text to *that* rather than
 * choosing one. */
function fitToWidth(
  line: string,
  available: number,
  height: number,
  forced?: number
): FittedLabel | null {
  if (!line || available <= 0 || height <= 0) return null;

  const byHeight = height * HEIGHT_RATIO;
  const byWidth = available / (line.length * ADVANCE_RATIO);
  const floor = byHeight * MIN_HEIGHT_FRACTION;
  // Below the floor the label is not shrunk further — it is cut instead, at the floor size.
  const fontSize = forced ?? Math.min(byHeight, Math.max(byWidth, floor));
  const text = textAtSize(line, available, fontSize);
  // Deliberately unrounded: the collage picks one size out of these and then re-fits the text to it,
  // and a size rounded up first would cut a label that in fact fits.
  return text === null ? null : { text, fontSize };
}

/** As much of `line` as fits `available` at `fontSize`, with an ellipsis when something was cut, or
 * null when not even one glyph fits. */
function textAtSize(line: string, available: number, fontSize: number): string | null {
  // The epsilon absorbs the float noise of a width that was itself derived from this font size.
  const maxChars = Math.floor(available / (fontSize * ADVANCE_RATIO) + 1e-6);
  if (maxChars < 1) return null;
  if (line.length <= maxChars) return line;
  return maxChars < 2 ? line.slice(0, 1) : `${line.slice(0, maxChars - 1)}…`;
}

/** One decimal is plenty for a font size and keeps the generated SVG stable to compare in tests. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The ink colour for a strip painted in `background`: black on a light collage, white on a dark
 * one. Relative luminance (Rec. 709), so a mid-tone background still lands on the readable side.
 * An unparseable colour is treated as light — the collage backgrounds a collector picks are.
 */
export function labelInkColor(background: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!hex) return "#000000";
  const value = parseInt(hex[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5 ? "#ffffff" : "#000000";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** What one tile's strip says: two independent annotations from two templates (#312), each already
 * resolved against that copy. Either side may be absent. */
export interface TileLabelTexts {
  left?: string | null;
  right?: string | null;
}

/** One annotation placed inside a strip, ready to become a `<text>`. */
export interface PlacedLabel extends FittedLabel {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}

/** Share of the strip's width kept clear between the two annotations, so a long left one and a long
 * right one cannot run into each other even at the largest size they are allowed. */
const GUTTER_RATIO = 0.06;

/**
 * Place a tile's annotations inside its strip: the left one flush left, the right one flush right,
 * **both at the same font size** so the strip reads as one line rather than two competing ones. A
 * side on its own is centred instead — one annotation in the middle of the stamp looks deliberate
 * where one hanging off an edge looks like the other went missing.
 *
 * The two share the strip's width, minus a gutter, **in proportion to their length** rather than
 * half each: a location ref beside a pair of catalog numbers is the normal case, and splitting the
 * strip down the middle would squeeze the long side to nothing while the short one sat in white
 * space. Proportional shares give both the same size per character, which is the same thing as
 * giving the strip one font size. Empty when the strip has no height or neither side has anything
 * to say.
 */
export function fitTileLabels(
  labels: TileLabelTexts,
  box: { x: number; y: number; width: number; height: number },
  forcedFontSize?: number
): PlacedLabel[] {
  const left = oneLine(labels.left ?? "");
  const right = oneLine(labels.right ?? "");
  if (box.height <= 0 || box.width <= 0 || (!left && !right)) return [];

  const inset = (box.width * (1 - WIDTH_RATIO)) / 2;
  const start = box.x + inset;
  const end = box.x + box.width - inset;

  // One side only: the whole strip, centred.
  if (!left || !right) {
    const fitted = fitToWidth(left || right, box.width * WIDTH_RATIO, box.height, forcedFontSize);
    if (!fitted) return [];
    return [{ ...fitted, x: box.x + box.width / 2, y: baseline(box, fitted.fontSize), anchor: "middle" }];
  }

  const usable = box.width * (WIDTH_RATIO - GUTTER_RATIO);
  const share = usable / (left.length + right.length);
  const fittedLeft = fitToWidth(left, share * left.length, box.height, forcedFontSize);
  const fittedRight = fitToWidth(right, share * right.length, box.height, forcedFontSize);
  if (!fittedLeft || !fittedRight) {
    // One side could not be drawn at all in its half; the other keeps the strip to itself.
    const only = fittedLeft ?? fittedRight;
    if (!only) return [];
    return [{ ...only, x: box.x + box.width / 2, y: baseline(box, only.fontSize), anchor: "middle" }];
  }

  const fontSize = Math.min(fittedLeft.fontSize, fittedRight.fontSize);
  const y = baseline(box, fontSize);
  return [
    { text: fittedLeft.text, fontSize, x: start, y, anchor: "start" },
    { text: fittedRight.text, fontSize, x: end, y, anchor: "end" },
  ];
}

/** Where the glyphs sit vertically inside the strip — computed rather than left to
 * `dominant-baseline`, which renderers disagree on. */
function baseline(box: { y: number; height: number }, fontSize: number): number {
  return box.y + (box.height + fontSize * CAP_RATIO) / 2;
}

/**
 * The label layer of one collage as an SVG the size of the canvas, ready to composite over the
 * tiles — or null when no tile has anything to say, so the renderer can skip the overlay entirely.
 *
 * `labels` is parallel to `layout.tiles`; a missing or blank entry leaves that tile unlabelled.
 * Drawn at the layout's **native** scale, before any output-limit downscale, so the labels shrink
 * with the stamps and keep their relative size.
 *
 * One font size for the **whole collage**, the smallest any tile needed: a narrow stamp beside a
 * wide one would otherwise carry a visibly smaller label, which reads as a mistake rather than as
 * fitting. The floor under the per-side fitting bounds how small that can get, so a single long
 * label cannot shrink the page — it is truncated instead.
 */
export function collageLabelSvg(
  layout: CollageLayout,
  labels: readonly (TileLabelTexts | null | undefined)[],
  background: string
): string | null {
  // Two passes. The first asks every tile what size it would take; the second draws them all at the
  // smallest of those — and re-fits the text to *that* size, so a label the first pass had to cut
  // for a narrow tile comes back whole once the collage settles on a smaller font.
  const wanted = layout.tiles.flatMap((tile, index) => fitTileLabels(labels[index] ?? {}, tile.label));
  if (wanted.length === 0) return null;
  const fontSize = Math.min(...wanted.map((p) => p.fontSize));

  const texts = layout.tiles.flatMap((tile, index) =>
    fitTileLabels(labels[index] ?? {}, tile.label, fontSize).map(
      (placed) =>
        `<text x="${round(placed.x)}" y="${round(placed.y)}" font-size="${round(fontSize)}"` +
        ` text-anchor="${placed.anchor}">${escapeXml(placed.text)}</text>`
    )
  );
  if (texts.length === 0) return null;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}">` +
    `<g font-family="${LABEL_FONT_FAMILY}" fill="${labelInkColor(background)}">` +
    texts.join("") +
    `</g></svg>`
  );
}
