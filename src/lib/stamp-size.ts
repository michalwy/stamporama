// A stamp's physical size (#763): reading one a collector typed, stating one it holds, taking one
// off a tile's crop, and finding one for a stamp that states none.
//
// Pure — no Prisma, no React, no DOM — for the reason `scan-measure.ts` is: these numbers are the
// whole product. A size decides how a hawid strip is cut (#755, #769), and material cut to a wrong
// figure does not come back. A rule written inside a component is a rule nothing can test.
//
// ## Millimetres, to a tenth
//
// {@link SIZE_DECIMALS} is one decimal place, everywhere: it is what a catalogue prints, it is
// about where a scan measured through a stated dpi stops having anything to say, and it is the
// column's own precision (`Decimal(5, 1)`). A figure carrying more is rounded on the way in rather
// than stored and quietly truncated by the database.
//
// ## A size is width **and** height
//
// Both columns are optional and either may stand alone — a half-filled record is a real state and
// the form must be free to be in it — but only a **complete** size is a size: it is the input to a
// box, and half a box cannot be drawn. So {@link statedStampSize} yields null unless both figures
// are there, and the resolution below looks straight past a stamp that holds only one of them.

/** How precisely a size is stated: a tenth of a millimetre, matching the column and the catalogue. */
export const SIZE_DECIMALS = 1;

/** The largest and smallest figure this app will accept as a stamp's dimension, in millimetres.
 * Wide on purpose — they are here to catch a slip (a gauge typed into the width, a size in
 * centimetres, a scan measured at the wrong scale), not to have an opinion about philately. The
 * ceiling is also the column's: `Decimal(5, 1)` holds four digits before the point. */
export const MIN_SIZE_MM = 1;
export const MAX_SIZE_MM = 9999.9;

/** A size as a stamp holds one: both figures, in millimetres. */
export interface StampSize {
  widthMm: number;
  heightMm: number;
}

/** What a stamp states about its size, either figure free to be absent. The stored shape, and what
 * the form edits; {@link statedStampSize} is the same thing collapsed to the complete case. */
export interface StampSizeFields {
  widthMm: number | null;
  heightMm: number | null;
}

/** Nothing stated — the normal state of both columns, named so a caller reads it as a value rather
 * than as two nulls it had to remember to write. */
export const NO_STAMP_SIZE: StampSizeFields = { widthMm: null, heightMm: null };

/** A figure rounded to the precision a size is stated at. Applied on the way in, so what is stored
 * is what was shown to be stored — a value rounded by the database on write would come back
 * different from the one the collector accepted. */
export function roundSizeMm(mm: number): number {
  const factor = 10 ** SIZE_DECIMALS;
  return Math.round(mm * factor) / factor;
}

/**
 * One dimension as it was typed.
 *
 * Blank is a real answer — *this stamp states no width* — and comes back as `null` with `ok` true;
 * anything the grammar cannot read comes back `ok: false` and must be reported, never stored. That
 * asymmetry is the point: a size the collector meant to type and mistyped, silently saved as *no
 * size*, is a stamp that then quietly borrows its neighbour's figure and is cut to it.
 *
 * A comma is read as a decimal point. The collector's own locale writes `21,5`, the field is one
 * number wide, and there is nothing else a comma could mean here.
 */
export function parseSizeMm(
  text: string | null | undefined
): { ok: true; mm: number | null } | { ok: false } {
  const value = (text ?? "").trim().replace(",", ".");
  if (!value) return { ok: true, mm: null };
  if (!/^\d+(\.\d+)?$/.test(value)) return { ok: false };
  const mm = Number(value);
  if (!Number.isFinite(mm) || mm < MIN_SIZE_MM || mm > MAX_SIZE_MM) return { ok: false };
  return { ok: true, mm: roundSizeMm(mm) };
}

/** One dimension as a field shows it: no trailing `.0`, because `21` is what a catalogue prints for
 * a stamp 21 mm wide and `21.0` claims a measurement that was not made. */
export function formatSizeMm(mm: number): string {
  return String(roundSizeMm(mm));
}

/** The complete size a stamp states, or null. Half a size is not a size: it is the input to a box,
 * and a box needs both figures — so a stamp holding only a width resolves through its checklist the
 * same as one holding nothing. The half figure is still shown on its own screen, because it is
 * still something the collector recorded. */
export function statedStampSize(fields: StampSizeFields | null | undefined): StampSize | null {
  if (!fields) return null;
  const { widthMm, heightMm } = fields;
  if (widthMm === null || heightMm === null) return null;
  return { widthMm, heightMm };
}

/** A size as a screen states one: `21.5 × 25 mm`. Null when the stamp states nothing at all; the
 * half-stated cases say which half they are, since `21.5 × ? mm` reads as a broken record rather
 * than as a width nobody has paired yet. */
export function formatStampSize(fields: StampSizeFields | null | undefined): string | null {
  if (!fields) return null;
  const { widthMm, heightMm } = fields;
  if (widthMm !== null && heightMm !== null) {
    return `${formatSizeMm(widthMm)} × ${formatSizeMm(heightMm)} mm`;
  }
  if (widthMm !== null) return `${formatSizeMm(widthMm)} mm wide`;
  if (heightMm !== null) return `${formatSizeMm(heightMm)} mm high`;
  return null;
}

/**
 * The size of a rectangle marked on a scan, or cut out of one.
 *
 * The whole of the pixels → size step, in one place, so there is exactly one line in the app that
 * could have it wrong — the argument `scanPixelsToMm` already makes for a distance. Null for a
 * degenerate box or an impossible scale, rather than a `0 × 0` that would render as a reading.
 *
 * Deliberately takes the dpi rather than reaching for one: the scale is stated and never inferred
 * (`scan-measure.ts`), and a size taken at a resolution nobody stated is exactly the figure that
 * gets written down and cut to.
 */
export function sizeFromScanPixels(
  box: { w: number; h: number },
  dpi: number,
  mmPerInch = 25.4
): StampSize | null {
  if (!(dpi > 0) || !(box.w > 0) || !(box.h > 0)) return null;
  const widthMm = roundSizeMm((box.w / dpi) * mmPerInch);
  const heightMm = roundSizeMm((box.h / dpi) * mmPerInch);
  if (widthMm < MIN_SIZE_MM || heightMm < MIN_SIZE_MM) return null;
  if (widthMm > MAX_SIZE_MM || heightMm > MAX_SIZE_MM) return null;
  return { widthMm, heightMm };
}

/** A stamp as the resolution reads one: an identity, and whatever it states about its size. The
 * caller hands these over **in catalog sort order**, which is the order the rule's whole argument
 * rests on. */
export interface StampSizeEntry extends StampSizeFields {
  stampId: string;
}

/** Where a size came from. `stated` is the stamp's own; `inherited` is a neighbour's, and says
 * whose — the surfaces that draw boxes (#769) have to be able to say so, and a figure presented
 * without that caveat is one a collector would cut to as if it had been measured. */
export interface ResolvedStampSize extends StampSize {
  source: "stated" | "inherited";
  /** The stamp the figure was taken from — this stamp when `stated`. */
  fromStampId: string;
}

/**
 * The size to use for a stamp, resolved through the checklist it sits in.
 *
 * **Resolved at read time, never stored.** A series is printed on one press at one size, so the
 * nearest stamp of the same checklist that does state a size is right far more often than it is
 * wrong — and where it is wrong the collector types over it, which stores a real value on that
 * stamp and ends the inheritance for it. Storing the borrowed figure instead would leave twenty
 * stamps each asserting a size nobody ever took, indistinguishable from twenty measurements.
 *
 * `entries` are the checklist **in catalog sort order** and the distance is counted in that order,
 * because that order is the press run: `301` and `302` came off the same sheet, `301` and `Bl 4`
 * did not. A tie goes to the earlier stamp — the low numbers of a series are its ordinary values,
 * and picking a side is what keeps two callers from resolving one stamp two ways.
 *
 * Null when nothing on the checklist states a complete size, which is what a checklist nobody has
 * measured yet looks like. A stamp not on the list at all also resolves to null rather than to its
 * first entry: it was not part of the run being reasoned about.
 */
export function resolveStampSize(
  entries: readonly StampSizeEntry[],
  stampId: string
): ResolvedStampSize | null {
  const index = entries.findIndex((e) => e.stampId === stampId);
  if (index === -1) return null;

  const own = statedStampSize(entries[index]);
  if (own) return { ...own, source: "stated", fromStampId: stampId };

  let best: { distance: number; entry: StampSizeEntry; size: StampSize } | null = null;
  for (let i = 0; i < entries.length; i++) {
    if (i === index) continue;
    const size = statedStampSize(entries[i]);
    if (!size) continue;
    const distance = Math.abs(i - index);
    // Strictly closer, or the same distance from earlier in the order — the loop runs forwards, so
    // an equal distance already held is the earlier stamp and keeps its claim.
    if (!best || distance < best.distance) best = { distance, entry: entries[i], size };
  }
  if (!best) return null;
  return { ...best.size, source: "inherited", fromStampId: best.entry.stampId };
}
