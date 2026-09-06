// The box-size rule (#765): what piece of hawid an album page draws for one stamp.
//
// Pure — no Prisma, no rendering — for `stamp-size.ts`'s reason and more sharply. These numbers get
// cut. A page (#767), its PDF (#768), the editor canvas (#769) and the cutting list (#770) all have
// to agree on the same millimetre, and the only way four surfaces agree is that none of them does
// the arithmetic.
//
// ## A box is a piece of hawid, not a stamp plus a margin
//
// Hawid is sold as **strips of a fixed height that you cut across**. The height is not chosen, it is
// picked out of the drawer; the width is the cut. So the two axes are not the same kind of number:
//
// - **Height** — the height of the shortest strip in stock that the stamp plus the template's
//   vertical clearance fits into. Not the stamp's height plus a margin: a box drawn at a height no
//   strip has is a page that disagrees with the piece lying on the desk.
// - **Width** — the stamp plus the template's horizontal margin, continuous, because that axis *is*
//   the cut.
//
// ## A strip is named after the stamp it takes, and that is two figures, not one (#793)
//
// The number on the packet is a **capacity**: `26 mm` accepts a 26 mm stamp, and the strip itself is
// about 30 mm tall, because the welded border is part of the product. Reading that one number as the
// strip's height got both jobs wrong at once — a 26 mm stamp with 4 mm of clearance demanded a
// *label* of 30 and so skipped the very packet it belongs in, and the box was then drawn 4 mm
// shorter than the piece the collector was about to glue down.
//
// So a strip carries both figures, and each does one job:
//
// - `heightMm` is the packet number — the identity of the row, and the tallest stamp it takes.
// - `totalHeightMm` is the strip's own outer height, border included: what a ruler laid against it
//   reads. The stamp plus the template's vertical clearance must fit **inside this**, and the box is
//   **drawn at it**, because this is the piece that ends up on the card.
//
// The template's vertical clearance keeps its own meaning and is not folded into either: it is how
// much room the collector wants around the stamp, and raising it should still buy a roomier mount.
//
// **A total of 0 is "not measured yet".** The border differs by product and cannot be derived, so a
// strip nobody has put a ruler to reads its packet number as the total — the arithmetic that ran
// before #793, unchanged, until a real figure is typed. Guessing it would be inventing the one
// number this module exists to keep honest.
//
// This replaces AlbumEasy's single global `STAMP_BOXES_SIZE_ADJUST(4)`, and it is what lets #770 be
// an instruction — *cut 38 mm off the 29 mm strip* — instead of a table of dimensions.
//
// ## Oversize is an answer, not an error
//
// A stamp taller than every strip in stock — a block, a souvenir sheet, a cover — gets a box of its
// own size plus the margins and **no strip**. Pieces that size go in a pocket, not a hawid, so the
// cutting list says so rather than naming a strip that does not exist and cannot be bought.
//
// An empty stock therefore makes every box oversize. That is deliberate: a collection that has not
// described its drawer gets a visibly unplanned page, not a silent default of 4 mm.

import { roundSizeMm, type StampSize } from "./stamp-size";

/** Millimetres to a tenth, as everywhere else the album track measures — the stamp sizes this rule
 *  consumes are stored at that precision, and a hawid strip is sold in whole millimetres anyway. */
export const HAWID_MM_DECIMALS = 1;
export const HAWID_MM_STEP = 0.1;

/** Strip-height bounds, for both figures. A sanity rail rather than an opinion: the packet numbers
 *  actually sold run from about 21 mm to 66 mm, and the strips themselves a few millimetres more,
 *  but a collector cutting sheet stock into their own strips is not wrong. */
export const MIN_STRIP_HEIGHT_MM = 5;
export const MAX_STRIP_HEIGHT_MM = 300;

/** Stock-length bounds, and the length nearly every strip is sold at — the figure a new row starts
 *  from, so the usual case is typed once and never again. */
export const MIN_STOCK_LENGTH_MM = 20;
export const MAX_STOCK_LENGTH_MM = 2000;
export const DEFAULT_STOCK_LENGTH_MM = 210;

/** A strip as the rule reads one. Only the measurements matter here; callers pass their own richer
 *  row (with its id and label) and get that same row back as the box's strip. */
export interface HawidStripSpec {
  /** The number printed on the packet: the tallest stamp this strip takes, not its own height. */
  heightMm: number;
  /** The strip's own outer height, border included — the figure a box is drawn at. **0 means it has
   *  not been measured**, and the rule then reads {@link heightMm} as the total; see the header. */
  totalHeightMm: number;
  /** The length of a strip as sold, which is the longest single piece it can yield. */
  stockLengthMm: number;
}

/** The height of the strip itself — the piece that lands on the card, and the height a box is drawn
 *  at. Falls back to the packet number for a strip nobody has measured, which is what keeps an
 *  undescribed drawer laying pages out exactly as it did before #793. */
export function hawidStripTotalHeightMm(strip: HawidStripSpec): number {
  return roundSizeMm(strip.totalHeightMm > 0 ? strip.totalHeightMm : strip.heightMm);
}

/** The welded border, top and bottom together: the strip's outer height less the stamp height it
 *  takes. The issue calls this the strip's *internal clearance*; it is the same number, named for
 *  the part you can see so it cannot be confused with the template's vertical clearance. **0 for a
 *  strip that has not been measured**, which is why {@link isHawidStripMeasured} exists rather than
 *  a caller testing this against zero. */
export function hawidStripBorderMm(strip: HawidStripSpec): number {
  return roundSizeMm(hawidStripTotalHeightMm(strip) - roundSizeMm(strip.heightMm));
}

/** Whether the collector has put a ruler to this strip. A row that has not been is usable — it just
 *  plans its boxes a border too short — so the dictionary says so rather than refusing it. */
export function isHawidStripMeasured(strip: HawidStripSpec): boolean {
  return strip.totalHeightMm > 0;
}

/** The clearances a box adds to the stamp, from the album template (#766). Two numbers, not one,
 *  and they do different jobs: the vertical one is added *before a strip is chosen* — it is how much
 *  strip has to be there above and below the stamp — while the horizontal one is the cut itself. */
export interface HawidMargins {
  verticalClearanceMm: number;
  horizontalMarginMm: number;
}

/** The piece of hawid a page draws for one stamp. `strip` is the row it is cut from, or **null** for
 *  an oversize box — a stamp no strip in stock is tall enough for, mounted in a pocket instead. */
export interface HawidBox<T extends HawidStripSpec = HawidStripSpec> {
  widthMm: number;
  heightMm: number;
  strip: T | null;
}

/** Whether a box is one no strip in stock can supply. The one place the null is read as a verdict,
 *  so a caller says `isOversize(box)` rather than re-deciding what a null strip means. */
export function isOversize(box: HawidBox): boolean {
  return box.strip === null;
}

/**
 * The box for one stamp: its size, the template's clearances, and the stock on hand.
 *
 * The chosen strip is the **shortest** one that fits, so the least material is spent; ties go to the
 * earlier entry, which is the collector's own order and keeps two callers from choosing two ways.
 * Short means the strip's own outer height, not its packet number (#793): that is the piece being
 * spent, it is what the stamp plus the clearance has to fit inside, and it is what the box is drawn
 * at. For a 26 mm stamp with 4 mm of clearance that is the 26 mm packet — 30 mm of strip — and not
 * the 30 mm packet, which is 34 mm of strip for the same stamp.
 *
 * A strip must also be long enough to cut the box's width from — a 210 mm strip cannot yield a
 * 240 mm piece, however tall it is. In practice that only ever bites a cover or a full sheet, which
 * is the oversize case regardless, but the alternative is a cutting list asking for a cut that
 * cannot be made.
 *
 * `stock` is taken in the collector's order and is never sorted in place.
 */
export function planHawidBox<T extends HawidStripSpec>(
  size: StampSize,
  margins: HawidMargins,
  stock: readonly T[]
): HawidBox<T> {
  // Rounded once, here, rather than compared raw: `24.9 + 0.1` is not `25` in binary floating point,
  // and the strip that mismatch picks is a taller one — material spent on an arithmetic artefact.
  const widthMm = roundSizeMm(size.widthMm + margins.horizontalMarginMm);
  const neededHeightMm = roundSizeMm(size.heightMm + margins.verticalClearanceMm);

  let chosen: T | null = null;
  let chosenTotalMm = 0;
  for (const strip of stock) {
    const totalMm = hawidStripTotalHeightMm(strip);
    if (totalMm < neededHeightMm) continue;
    if (strip.stockLengthMm < widthMm) continue;
    if (!chosen || totalMm < chosenTotalMm) {
      chosen = strip;
      chosenTotalMm = totalMm;
    }
  }

  if (!chosen) return { widthMm, heightMm: neededHeightMm, strip: null };
  return { widthMm, heightMm: chosenTotalMm, strip: chosen };
}

/** A strip in words, for a picker or a cutting line: `29 mm (Hawid 264)`, or just `29 mm`. The
 *  packet number, because that is what is written on the drawer and what you reach for — the outer
 *  height is the box's business, and the dictionary shows it beside this. */
export function hawidStripLabel(strip: { heightMm: number; label?: string | null }): string {
  const height = `${roundSizeMm(strip.heightMm)} mm`;
  const label = strip.label?.trim();
  return label ? `${height} (${label})` : height;
}

/** A box in words: `38 × 33 mm from the 29 mm strip`, or `86 × 72 mm — pocket, no strip fits`. The
 *  two heights differ on purpose: the box is the piece of strip, the name is the packet it came out
 *  of. */
export function describeHawidBox(box: {
  widthMm: number;
  heightMm: number;
  strip: { heightMm: number; label?: string | null } | null;
}): string {
  const size = `${roundSizeMm(box.widthMm)} × ${roundSizeMm(box.heightMm)} mm`;
  return box.strip
    ? `${size} from the ${hawidStripLabel(box.strip)} strip`
    : `${size} — pocket, no strip fits`;
}

/** What a strip row holds, as the dictionary's form submits it. */
export interface HawidStripInput extends HawidStripSpec {
  label: string | null;
}

export type HawidStripParseResult =
  | { ok: true; value: HawidStripInput }
  | { ok: false; message: string };

/**
 * Parses one millimetre field: required, at most a tenth, either decimal separator — a collector
 * typing `24,5` means `24.5`, as everywhere else a decimal is entered in this app.
 */
export function parseHawidMillimetres(
  raw: string,
  label: string,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return { ok: false, message: `${label} is required.` };
  if (!new RegExp(`^\\d+(\\.\\d{1,${HAWID_MM_DECIMALS}})?$`).test(trimmed)) {
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

/**
 * Validates the raw strings the Settings form submits, reporting the first problem found.
 *
 * The outer height is the one **optional** field: a collector who has not put a ruler to the packet
 * leaves it blank and gets 0, which the rule reads as *use the packet number* (#793). Demanding it
 * would only buy a guessed millimetre, and the guess is the failure this module exists to prevent.
 * Given, it cannot be shorter than the stamp height the packet takes — the border adds to that
 * figure, it does not come out of it.
 */
export function parseHawidStripInput(raw: {
  heightMm: string;
  totalHeightMm: string;
  stockLengthMm: string;
  label: string;
}): HawidStripParseResult {
  const heightMm = parseHawidMillimetres(
    raw.heightMm,
    "Stamp height",
    MIN_STRIP_HEIGHT_MM,
    MAX_STRIP_HEIGHT_MM
  );
  if (!heightMm.ok) return heightMm;

  let totalHeightMm = 0;
  if (raw.totalHeightMm.trim()) {
    const parsed = parseHawidMillimetres(
      raw.totalHeightMm,
      "Outer height",
      MIN_STRIP_HEIGHT_MM,
      MAX_STRIP_HEIGHT_MM
    );
    if (!parsed.ok) return parsed;
    if (parsed.value < heightMm.value) {
      return {
        ok: false,
        message: `Outer height must be at least the ${heightMm.value} mm stamp height — the border adds to it.`,
      };
    }
    totalHeightMm = parsed.value;
  }

  const stockLengthMm = parseHawidMillimetres(
    raw.stockLengthMm,
    "Stock length",
    MIN_STOCK_LENGTH_MM,
    MAX_STOCK_LENGTH_MM
  );
  if (!stockLengthMm.ok) return stockLengthMm;

  const label = raw.label.trim();
  return {
    ok: true,
    value: {
      heightMm: heightMm.value,
      totalHeightMm,
      stockLengthMm: stockLengthMm.value,
      label: label || null,
    },
  };
}
