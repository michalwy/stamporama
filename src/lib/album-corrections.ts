// The vocabulary of a hand correction on an album page (#769) — the words, the bounds and the one
// piece of arithmetic a correction performs.
//
// **Pure.** No Prisma, no React: the editor's fields, the server actions that store what they typed
// and `album-plan.ts`'s application of a stored correction all read the same list, and the unit tests
// reach it. `album-layout.ts` is where a correction is *packed*; this is only what one may say.
//
// ## Corrections are relative, and that is the whole design
//
// Every value here is a delta against what the automatic layout produced — *this box 2 mm wider*,
// *5 mm more before this series*, *break here* — never an absolute coordinate. ADR-0045 §3 is why:
// a live page has no row and its identity is derived from its own contents, so anything stored
// against a position would be invalidated by the next stamp the collector buys. A delta hangs on an
// entry, a block or a stamp, all three of which are rows, and the automatic layout goes on running
// underneath it. That is what makes a correction survive a content change instead of having to be
// re-typed after every acquisition.
//
// ## What was counted before this was built
//
// `~/Documents/AlbumEasy`, the collector's own six areas: **480** `PAGE_VSPACE` over **198**
// `PAGE_START(` pages, which makes extra vertical space by a long way the correction he actually
// makes. Every negative one of them (18) is in a `_*.txt` running-head include and none is in page
// content, which is why {@link ALBUM_SPACE_MIN_MM} is negative but small and the layout floors a
// block's lead at zero. The largest in the corpus is 55 mm; {@link ALBUM_SPACE_MAX_MM} leaves room
// above that and stops a mistyped figure spending a whole card.
//
// The break kinds and the free text block have **no** such corpus — AlbumEasy paginates by hand, so
// his `PAGE_START(` are the breaks and there is no `PAGE_BREAK` anywhere, and
// `PAGE_TEXT_PARAGRAPH_START` appears 21 times in that program's own `examples/` and not once in his
// pages. Both are inventions asked for in #755, and are labelled as such rather than presented as
// measured.

import type { AlbumBlockBreak, AlbumTextRole } from "./album-layout";
import { roundSizeMm, type StampSize } from "./stamp-size";

/**
 * Where a page may break above a block, in the words the collector reads them in.
 *
 * `avoid` is deliberately worded as *keep with* rather than *never break*: it is a preference the
 * packer honours by making the unit that moves whole bigger, and a run of them taller than a sheet
 * is dropped rather than looped over. A label promising *never* would be a promise the geometry
 * cannot keep.
 */
export const ALBUM_BLOCK_BREAKS = [
  { key: "auto", label: "Wherever it falls", hint: "The layout decides" },
  {
    key: "always",
    label: "Start a new sheet",
    hint: "Unless nothing is on this one yet",
  },
  {
    key: "avoid",
    label: "Keep with the block above",
    hint: "Dropped when no sheet could hold both",
  },
] as const;

export function asAlbumBlockBreak(raw: string): AlbumBlockBreak {
  return ALBUM_BLOCK_BREAKS.some((b) => b.key === raw)
    ? (raw as AlbumBlockBreak)
    : "auto";
}

/**
 * The roles a free text block may be set in — the template's own five, and nothing new.
 *
 * Reusing them is the whole of what "from the template's text roles" (#769) buys. A sixth type
 * setting for notes would be a face and a size the collector has to configure before a note can be
 * typed, and would then be the one voice on the page that does not change when they re-seed the
 * album from a template.
 */
export const ALBUM_TEXT_BLOCK_ROLES = [
  { key: "chapter", label: "Chapter heading", hint: "The year's own size" },
  { key: "heading", label: "Checklist heading", hint: "The ordinary block heading" },
  { key: "label", label: "Box label", hint: "The small print under a mount" },
  { key: "footer", label: "Footer", hint: "The smallest voice on the sheet" },
  { key: "title", label: "Running head", hint: "The album's own name size" },
] as const;

/** Which side of its anchor a note is filed on (#769). Two statements, not one with a sign: *after
 *  the last entry of 1949* and *before the first of 1950* name the same gap today and different ones
 *  the moment the album is reordered, and a chapter's opening note needs the second. */
export const ALBUM_TEXT_BLOCK_SIDES = [
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
] as const;

export type AlbumTextBlockSide = (typeof ALBUM_TEXT_BLOCK_SIDES)[number]["key"];

export function asAlbumTextBlockSide(raw: string): AlbumTextBlockSide {
  return raw === "before" ? "before" : "after";
}

export function asAlbumTextRole(raw: string): AlbumTextRole {
  return ALBUM_TEXT_BLOCK_ROLES.some((r) => r.key === raw)
    ? (raw as AlbumTextRole)
    : "heading";
}

/** Sanity rails, not opinions. Negative space closes a gap the automatic lead opened — the layout
 *  floors the resulting lead at zero — and the ceiling is well clear of the 55 mm largest in the
 *  corpus while stopping a mistyped figure from spending a card. */
export const ALBUM_SPACE_MIN_MM = -50;
export const ALBUM_SPACE_MAX_MM = 200;

/** A box correction is millimetres on a stamp, so the range is the range a stamp's own size has. A
 *  negative one bigger than the stamp is clamped rather than refused: it is a drag that overshot. */
export const ALBUM_BOX_DELTA_MIN_MM = -100;
export const ALBUM_BOX_DELTA_MAX_MM = 200;

/** Millimetres are corrected to a tenth, like every other figure this track cuts to. */
export const ALBUM_CORRECTION_STEP_MM = 0.1;

/**
 * One signed millimetre field as the editor submits it.
 *
 * Signed, which is what separates it from `parseHawidMillimetres` — a strip height cannot be
 * negative and a correction can. Either decimal separator, because a collector typing `2,5` means
 * `2.5` everywhere else in this app. Blank reads as **zero**, since clearing the field is how a
 * correction is taken back and an empty box is not an error to report.
 */
export function parseAlbumCorrectionMm(
  raw: string,
  label: string,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed || trimmed === "-") return { ok: true, value: 0 };
  if (!/^-?\d+(\.\d)?$/.test(trimmed)) {
    return {
      ok: false,
      message: `${label} must be a number of millimetres with at most one decimal place.`,
    };
  }
  const value = Number(trimmed);
  if (value < min || value > max) {
    return { ok: false, message: `${label} must be between ${min} and ${max} mm.` };
  }
  return { ok: true, value };
}

/** What one box has been corrected by. Both zero is the same as no correction at all, and is stored
 *  as no row — an album that has never disagreed with the box rule keeps nothing, exactly as one
 *  that has never disagreed with a checklist's order keeps no `AlbumEntryStampOrder` rows. */
export interface AlbumBoxAdjustmentValue {
  widthDeltaMm: number;
  heightDeltaMm: number;
}

export function isEmptyBoxAdjustment(value: AlbumBoxAdjustmentValue): boolean {
  return value.widthDeltaMm === 0 && value.heightDeltaMm === 0;
}

/**
 * A corrected stamp size — the input the box rule (#765) is then run over.
 *
 * **The correction lands on the stamp, not on the box the rule produced**, and that is the load
 * bearing half of this function. A hawid box's height is not a chosen number: it is the height of the
 * shortest strip in the drawer the piece fits into, because hawid is sold as strips of a fixed height
 * that are cut across. A correction applied to the finished box would draw one at a height no strip
 * has — which is precisely the page-disagrees-with-the-desk failure that whole rule exists to
 * prevent.
 *
 * So a height correction moves the box in **strip steps**: 2 mm more clearance may change nothing, or
 * may take the box up to the next strip in stock. The width axis *is* the cut and moves continuously.
 * Raising past the tallest strip, or widening past a strip's stock length, makes the box oversize —
 * a pocket — which is an answer rather than an error and is what #770 will print.
 *
 * The two axes reaching the same place whether the delta is added before or after the clearances is
 * arithmetic rather than luck (`stamp + delta + clearance` is `stamp + clearance + delta`); doing it
 * here keeps every decision about strips inside `hawid.ts`.
 */
export function albumCorrectedStampSize(
  size: StampSize,
  adjustment: AlbumBoxAdjustmentValue | null | undefined,
): StampSize {
  if (!adjustment || isEmptyBoxAdjustment(adjustment)) return size;
  return {
    widthMm: Math.max(0, roundSizeMm(size.widthMm + adjustment.widthDeltaMm)),
    heightMm: Math.max(0, roundSizeMm(size.heightMm + adjustment.heightDeltaMm)),
  };
}
