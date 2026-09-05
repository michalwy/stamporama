// The album's text measurer (#767, #768): the **one** implementation of {@link AlbumTextMetrics}.
//
// It measures the *embedded* faces (`album-font-bytes.ts`), so the width the page plan breaks a
// block on and the width the PDF draws are the same number rather than two figures that happen to
// be close.
//
// ## Why there is exactly one of these
//
// `album-layout.ts` decides where a block stops fitting, and that decision rests on how wide a
// heading is. If the PDF asked pdf-lib and the canvas asked the browser's `measureText`, the two
// would answer differently for the same string and the screen would show a break the paper does not
// have. Every surface asks this module, and the layout engine takes it as a port so that staying
// honest is a one-line import rather than a habit.
//
// The obligation is sharper than "share it": **the client does not measure, because the client is
// not a planner** (ADR-0045 §7). #769's canvas draws a server-computed plan and its corrections are
// deltas. So this module reading font files off disk is not a limitation to route around — it is
// the rule made structural.
//
// ## It agrees with pdf-lib by construction, not by luck
//
// pdf-lib's `CustomFontEmbedder.widthOfTextAtSize` lays the string out with fontkit and sums each
// glyph's `advanceWidth`, scaled by `1000 / unitsPerEm` and then by `size / 1000`. That reduces to
// `sum(advanceWidth) / unitsPerEm × size`, which is exactly {@link albumTextMetrics.measureMm}
// below, and it is the same arithmetic the embedder writes into the PDF's own `W` array — so it is
// also what a viewer and a printer advance by.
//
// Two details are deliberate and both are copied from that function rather than improved on:
//
// - The sum is over the glyphs' **`advanceWidth`**, not over the run's positioned advances. pdf-lib
//   draws glyph ids in a plain show-text operator, so no kerning is applied on the paper; measuring
//   a kerned width would predict a line the printer never sets.
// - `layout()` is called with **no feature list**, which is what pdf-lib passes unless a caller
//   customises it. Note that pdf-lib exposes no OpenType feature selection at all (`album-fonts.ts`
//   says the same, one layer up), so `tnum` and friends are unreachable and a face's default
//   figures are the figures you get.
//
// ## This replaced an estimate, and the estimate is not coming back
//
// #767 shipped a table of average advances per family in ems, because there were no font bytes in
// the repository. It was honest about being provisional and it was safe for one reason — nothing
// could be printed before #768 — which stopped being true the moment this file did its job. Every
// plan those estimates produced was a live page and re-flows against the real advances.
//
// ## Points in, millimetres out
//
// Type is stated in points (#766) and paper is measured in millimetres, so the conversion happens
// here, once, at {@link PT_TO_MM}.

import type { AlbumTextMetrics } from "./album-layout";
import { isAlbumFaceId } from "./album-fonts";
import { loadAlbumFace } from "./album-font-bytes";
import { roundSizeMm } from "./stamp-size";

/** A point is a 72nd of an inch; an inch is 25.4 mm. */
export const PT_TO_MM = 25.4 / 72;

/** Millimetres to points — the PDF's own unit. The only arithmetic in the whole renderer. */
export const MM_TO_PT = 72 / 25.4;

/**
 * Baseline to baseline as a multiple of the type size.
 *
 * 1.2 is the default leading of every face here and of every renderer that has an opinion — it is
 * what a PDF viewer, a browser and AlbumEasy all fall back to. A template that wanted looser lines
 * would be asking for a setting, and nobody has.
 *
 * Deliberately **not** taken from the faces' own `hhea` metrics now that the bytes are here. The
 * six families do not agree on line gap, so reading it per face would make an album's page breaks
 * move when the collector changed a heading from Liberation to Noto — a plan that reflows on a
 * cosmetic choice. The *baseline within* the line is a different question and does read the face:
 * see {@link albumBaselineOffsetMm}.
 */
const LINE_HEIGHT_FACTOR = 1.2;

/**
 * The face a measurement falls back to when a template names one this build no longer ships.
 *
 * Measuring must not fail — a screen still has to render an album written against a dropped face,
 * and a plan is only a derivation. **Drawing** is the opposite: `album-pdf.ts` refuses such a face
 * by name rather than printing the collector's page in something they did not choose. The split is
 * the point, and `album-fonts.ts` states the rule.
 */
const FALLBACK_FACE = "liberation-sans";

function faceFor(faceId: string) {
  return loadAlbumFace(isAlbumFaceId(faceId) ? faceId : FALLBACK_FACE);
}

/**
 * The measurer every surface asks.
 *
 * Not rounded to a tenth of a millimetre: this is an input to the layout's own arithmetic, which
 * rounds where it stores a coordinate. Rounding a measurement before it is summed would quantise a
 * per-glyph advance into a per-glyph error.
 */
export const albumTextMetrics: AlbumTextMetrics = {
  measureMm(text: string, faceId: string, sizePt: number): number {
    if (!text) return 0;
    const font = faceFor(faceId);
    const { glyphs } = font.layout(text);
    let units = 0;
    for (const glyph of glyphs) units += glyph.advanceWidth;
    return (units / font.unitsPerEm) * sizePt * PT_TO_MM;
  },

  lineHeightMm(_faceId: string, sizePt: number): number {
    return roundSizeMm(sizePt * LINE_HEIGHT_FACTOR * PT_TO_MM);
  },
};

/**
 * How far below the top of a line box that line's baseline sits, in millimetres.
 *
 * The renderers need this and the layout does not — a plan reserves a band of whole lines and never
 * asks where the ink inside one falls — so it is exported beside the port rather than added to it.
 * It lives here all the same, for the port's own reason: the PDF and #769's canvas must put a
 * heading's ink in the same place, and a renderer that works it out for itself is a renderer that
 * can work it out differently.
 *
 * The rule is the browser's: centre the face's own ascent-to-descent box inside the 1.2 line box
 * (half the difference above, half below) and sit the baseline an ascent below that. Reading the
 * face here is safe in a way reading it for {@link LINE_HEIGHT_FACTOR} is not — it moves ink within
 * a band whose height is already fixed, so no page break can depend on it.
 */
export function albumBaselineOffsetMm(faceId: string, sizePt: number): number {
  const font = faceFor(faceId);
  const sizeMm = sizePt * PT_TO_MM;
  // fontkit reports `descent` as a negative number of font units, so the content box is the
  // difference rather than the sum.
  const ascentMm = (font.ascent / font.unitsPerEm) * sizeMm;
  const contentMm = ((font.ascent - font.descent) / font.unitsPerEm) * sizeMm;
  const lineMm = albumTextMetrics.lineHeightMm(faceId, sizePt);
  return (lineMm - contentMm) / 2 + ascentMm;
}
