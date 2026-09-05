// The album's text measurer (#767): the **one** implementation of {@link AlbumTextMetrics}.
//
// Pure — no font files, no Prisma, no DOM — so the page plan is measured identically wherever it is
// planned: on the server for the PDF (#768), in the browser for the editor canvas (#769), and in
// `test:unit` on plain numbers.
//
// ## Why there is exactly one of these
//
// `album-layout.ts` decides where a block stops fitting, and that decision rests on how wide a
// heading is. If the PDF asked pdf-lib and the canvas asked the browser's `measureText`, the two
// would answer differently for the same string and the screen would show a break the paper does not
// have. Every surface asks this module, and the layout engine takes it as a port so that staying
// honest is a one-line import rather than a habit.
//
// ## This table is provisional, and #768 replaces it in place
//
// The exact advances belong to the faces the PDF embeds, and embedding them is #768's deliverable —
// there are no font bytes in this repository yet. Until they arrive, widths here are estimated from
// each family's em proportions rather than measured from its glyphs, so a heading may wrap a word
// earlier or later than the printed sheet will.
//
// That is safe for exactly one reason, and it is worth stating because it stops being true later:
// **nothing can be printed before #768 exists**, since printing is #768. Every page this measurer
// has ever planned is a live page, and a live page is re-planned whenever anything it reads changes
// (#755). When the real advances land, every plan simply re-flows. Once a page can be marked printed
// (#778), its geometry is a stored snapshot and changing this file would no longer reach it — which
// is the property that makes the snapshot the right shape, not a reason to leave the estimate in.
//
// **To replace it:** keep {@link albumTextMetrics}'s signature, measure `text` through the embedded
// face for `faceId`, and delete the estimation below. Nothing else in the app measures text.
//
// ## Points in, millimetres out
//
// Type is stated in points (#766) and paper is measured in millimetres, so the conversion happens
// here, once, at {@link PT_TO_MM}.

import type { AlbumTextMetrics } from "./album-layout";
import { findAlbumFace } from "./album-fonts";
import { roundSizeMm } from "./stamp-size";

/** A point is a 72nd of an inch; an inch is 25.4 mm. */
export const PT_TO_MM = 25.4 / 72;

/**
 * Baseline to baseline as a multiple of the type size.
 *
 * 1.2 is the default leading of every face here and of every renderer that has an opinion — it is
 * what a PDF viewer, a browser and AlbumEasy all fall back to. A template that wanted looser lines
 * would be asking for a setting, and nobody has.
 */
const LINE_HEIGHT_FACTOR = 1.2;

/**
 * Average advance per character, in ems, per family — the estimate this module is provisional
 * about.
 *
 * The two figures that matter are the ones the collector's own pages are set in: a humanist sans of
 * Arial's proportions averages about half an em across mixed-case running text, and a Times-class
 * serif is narrower at roughly 0.45, which is the whole reason a newspaper is set in one. Noto's
 * two are the same shapes at the same proportions. The narrow and condensed cuts are their family's
 * figure at the ratio those cuts are drawn to.
 */
const FAMILY_EM: Record<string, number> = {
  "liberation-serif": 0.45,
  "liberation-sans": 0.5,
  "liberation-sans-narrow": 0.41,
  "noto-serif": 0.46,
  "noto-sans": 0.5,
  "noto-sans-condensed": 0.43,
};

/** Bold cuts are drawn a little wider than their regular; italics are not systematically narrower
 *  in either family, so only weight moves the figure. */
const BOLD_FACTOR = 1.04;

/**
 * How wide one character is relative to its family's average.
 *
 * A flat average wraps badly on the strings an album actually prints: a catalog label is `303` and a
 * checklist heading is a Polish sentence, and the two have very different letter mixes. Four buckets
 * are enough to tell them apart and few enough to be worth stating rather than tabulating.
 */
function charFactor(ch: string): number {
  if (ch === " ") return 0.56;
  if ("iljItfr.,;:'!|()[]-".includes(ch)) return 0.5;
  if ("mwMW@%".includes(ch)) return 1.65;
  // Digits and capitals are set on wider bodies than lowercase in every text face; digits in
  // particular are all one width, which is what makes a catalog label measurable at all.
  if (/[0-9A-ZĄĆĘŁŃÓŚŹŻÄÖÜ]/.test(ch)) return 1.3;
  return 1;
}

/** The average advance of one em for a face id, falling back to the sans figure for a face this
 *  build does not ship — a template written against a dropped face still has to be measurable, and
 *  `album-fonts.ts` already refuses such a face at the form. */
function emFor(faceId: string): number {
  const face = findAlbumFace(faceId);
  if (!face) return FAMILY_EM["liberation-sans"];
  const base = FAMILY_EM[face.family] ?? FAMILY_EM["liberation-sans"];
  return face.bold ? base * BOLD_FACTOR : base;
}

/**
 * The measurer every surface asks.
 *
 * Not rounded to a tenth of a millimetre: this is an input to the layout's own arithmetic, which
 * rounds where it stores a coordinate. Rounding a measurement before it is summed would quantise a
 * per-character estimate into a per-character error.
 */
export const albumTextMetrics: AlbumTextMetrics = {
  measureMm(text: string, faceId: string, sizePt: number): number {
    const em = emFor(faceId) * sizePt * PT_TO_MM;
    let width = 0;
    for (const ch of text) width += charFactor(ch) * em;
    return width;
  },

  lineHeightMm(_faceId: string, sizePt: number): number {
    return roundSizeMm(sizePt * LINE_HEIGHT_FACTOR * PT_TO_MM);
  },
};
