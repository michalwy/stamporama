/**
 * Pure rules for ref-card templates (#569) — no Prisma, so the sheet, the Settings panel and the
 * server action all read one definition of what a card is.
 *
 * **Millimetres throughout.** The sheet used to mix `cm` and `rem`; for something whose whole
 * purpose is fitting a physical pocket, one print unit is worth more than the convenience.
 *
 * There is deliberately **no rows or columns field**: `grid-template-columns: repeat(auto-fill,
 * <cardWidthMm>mm)` lets the browser fit as many cards per row as the paper allows and flow the rest
 * below, so nothing here has to know the page size and A4 and Letter both work without being asked
 * about. How many cards there are is answered by the strip (`start` + `count`), not by the format.
 */

/** Card size bounds. The floor is a card small enough to be pointless and the ceiling a card wider
 *  than any paper it could be printed on — this is a sanity rail, not a recommendation. */
export const MIN_CARD_MM = 5;
export const MAX_CARD_MM = 200;

/** Type-size bounds, and the top padding's. A ref at 0 mm is invisible; padding is allowed to be 0,
 *  which prints the ref hard against the card's top edge. */
export const MIN_FONT_MM = 1;
export const MAX_FONT_MM = 50;
export const MIN_PADDING_MM = 0;
export const MAX_PADDING_MM = 100;

/** Millimetres are entered to a tenth. Whole millimetres cannot state 62.5 mm stock, and a tenth of
 *  a millimetre is already finer than a household printer places a line. */
export const REF_CARD_MM_DECIMALS = 1;
export const REF_CARD_MM_STEP = 0.1;

export interface RefCardGeometry {
  cardWidthMm: number;
  cardHeightMm: number;
  fontSizeMm: number;
  paddingTopMm: number;
}

/**
 * What the sheet prints when the collection has no template, and what a new template's form starts
 * at: #565's own geometry, converted — four cards across a printable A4 width, 24 mm tall (its
 * `2.4cm`), the ref at roughly its `1.5rem`.
 *
 * A **constant, not a seeded row**. Nothing is written to the database on first use: a printed sheet
 * is recorded nowhere, so there is no act for a stored default to make consistent, and a collector
 * who never opens Settings should still get a printable sheet.
 */
export const DEFAULT_REF_CARD_GEOMETRY: RefCardGeometry = {
  cardWidthMm: 45,
  cardHeightMm: 24,
  fontSizeMm: 6,
  paddingTopMm: 3,
};

export interface RefCardTemplateInput extends RefCardGeometry {
  name: string;
}

export type RefCardTemplateParseResult =
  | { ok: true; value: RefCardTemplateInput }
  | { ok: false; message: string };

/**
 * Parses a millimetre field: required, at most a tenth, either decimal separator — a collector
 * typing `62,5` means the same as `62.5`, as everywhere else a decimal is entered here.
 */
export function parseMillimetres(
  raw: string,
  label: string,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return { ok: false, message: `${label} is required.` };
  if (!new RegExp(`^\\d+(\\.\\d{1,${REF_CARD_MM_DECIMALS}})?$`).test(trimmed)) {
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

/** Validates the raw strings the Settings form submits. Reports the first problem found; the panel
 *  surfaces the message inline in the dialog, the collage template panel's idiom (#307). */
export function parseRefCardTemplateInput(raw: {
  name: string;
  cardWidthMm: string;
  cardHeightMm: string;
  fontSizeMm: string;
  paddingTopMm: string;
}): RefCardTemplateParseResult {
  const name = raw.name.trim();
  if (!name) return { ok: false, message: "Name is required." };

  const cardWidthMm = parseMillimetres(raw.cardWidthMm, "Card width", MIN_CARD_MM, MAX_CARD_MM);
  if (!cardWidthMm.ok) return cardWidthMm;

  const cardHeightMm = parseMillimetres(raw.cardHeightMm, "Card height", MIN_CARD_MM, MAX_CARD_MM);
  if (!cardHeightMm.ok) return cardHeightMm;

  const fontSizeMm = parseMillimetres(raw.fontSizeMm, "Ref size", MIN_FONT_MM, MAX_FONT_MM);
  if (!fontSizeMm.ok) return fontSizeMm;

  const paddingTopMm = parseMillimetres(
    raw.paddingTopMm,
    "Top padding",
    MIN_PADDING_MM,
    MAX_PADDING_MM
  );
  if (!paddingTopMm.ok) return paddingTopMm;

  // The ref has to land on the card. A padding at or past the card's height prints an empty sheet,
  // which is a mistake worth catching before the paper is spent rather than after.
  if (paddingTopMm.value + fontSizeMm.value > cardHeightMm.value) {
    return {
      ok: false,
      message: "Top padding plus the ref size must fit inside the card height.",
    };
  }

  return {
    ok: true,
    value: {
      name,
      cardWidthMm: cardWidthMm.value,
      cardHeightMm: cardHeightMm.value,
      fontSizeMm: fontSizeMm.value,
      paddingTopMm: paddingTopMm.value,
    },
  };
}

/** A template in words, for the Settings row and the sheet's picker: `45 × 24 mm · ref 6 mm`. */
export function refCardGeometrySummary(g: RefCardGeometry): string {
  return `${g.cardWidthMm} × ${g.cardHeightMm} mm · ref ${g.fontSizeMm} mm from ${g.paddingTopMm} mm`;
}
