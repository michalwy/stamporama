/**
 * Pure validation for collage templates (#307) — no Prisma, so it is unit-testable and can be
 * reused by the offer-side form once the offer carries its own copy of these numbers (#308).
 *
 * Sizes are **percentages of the stamp**, never pixels (#312). A collector cannot pick a pixel
 * number without knowing the scan DPI *and* how far the platform's limits will shrink the finished
 * collage — and neither is knowable when the template is written. Relative sizes need neither:
 * whether a label is readable next to a stamp does not change when the whole image is scaled, and
 * an image scaled far enough for the label to vanish has already lost the stamp. The renderer
 * resolves them against the **median tile height** of the collage it is laying out (#310).
 */

/** Capacity bounds. A 1×1 template is the single-stamp case and is deliberately allowed. */
export const MIN_COLLAGE_AXIS = 1;
export const MAX_COLLAGE_AXIS = 20;

/** Bounds shared by `gapPercent` and `labelPercent`, in percent of the stamp height. 0 means
 * "none" — no gap, or no label strip at all. The ceiling is a sanity rail: a strip as tall as the
 * stamp above it is already absurd. */
export const MIN_COLLAGE_PERCENT = 0;
export const MAX_COLLAGE_PERCENT = 100;

/** What a new template starts at: a comfortable margin and a strip whose text lands at roughly a
 * tenth of the stamp's height, which stays readable at every output size. */
export const DEFAULT_COLLAGE_GAP_PERCENT = 5;
export const DEFAULT_COLLAGE_LABEL_PERCENT = 14;

export const DEFAULT_COLLAGE_BACKGROUND = "#ffffff";

export interface CollageTemplateInput {
  name: string;
  rows: number;
  columns: number;
  /** Space between tiles, rows and around the collage, as a percent of the stamp height. */
  gapPercent: number;
  background: string;
  /** Height of each tile's label strip, as a percent of the stamp height. */
  labelPercent: number;
}

export type CollageTemplateParseResult =
  | { ok: true; value: CollageTemplateInput }
  | { ok: false; message: string };

/**
 * Normalises a user-typed colour to lowercase `#rrggbb`. Accepts a missing `#` and the 3-digit
 * shorthand browsers allow; returns null when the value is not a hex colour at all.
 */
export function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[0]}${trimmed[0]}${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(trimmed)) return `#${trimmed}`;
  return null;
}

/** Parses a required whole number within bounds. Exported for the offer-side photo configuration
 * (#308), which validates the same numbers once they are copied onto an offer. */
export function parseBoundedInteger(raw: string, label: string, min: number, max: number):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: `${label} is required.` };
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, message: `${label} must be a whole number.` };
  }
  const value = Number(trimmed);
  if (value < min || value > max) {
    return { ok: false, message: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

/**
 * Validates the raw strings a form submits into a collage template. Reports the first problem
 * found; the panel surfaces the message inline in the dialog.
 */
export function parseCollageTemplateInput(raw: {
  name: string;
  rows: string;
  columns: string;
  gapPercent: string;
  background: string;
  labelPercent: string;
}): CollageTemplateParseResult {
  const name = raw.name.trim();
  if (!name) return { ok: false, message: "Name is required." };

  const rows = parseBoundedInteger(raw.rows, "Rows", MIN_COLLAGE_AXIS, MAX_COLLAGE_AXIS);
  if (!rows.ok) return rows;

  const columns = parseBoundedInteger(raw.columns, "Columns", MIN_COLLAGE_AXIS, MAX_COLLAGE_AXIS);
  if (!columns.ok) return columns;

  const gapPercent = parseBoundedInteger(
    raw.gapPercent,
    "Gap",
    MIN_COLLAGE_PERCENT,
    MAX_COLLAGE_PERCENT
  );
  if (!gapPercent.ok) return gapPercent;

  const labelPercent = parseBoundedInteger(
    raw.labelPercent,
    "Label strip",
    MIN_COLLAGE_PERCENT,
    MAX_COLLAGE_PERCENT
  );
  if (!labelPercent.ok) return labelPercent;

  const background = normalizeHexColor(raw.background);
  if (!background) {
    return { ok: false, message: "Background must be a hex colour such as #ffffff." };
  }

  return {
    ok: true,
    value: {
      name,
      rows: rows.value,
      columns: columns.value,
      gapPercent: gapPercent.value,
      background,
      labelPercent: labelPercent.value,
    },
  };
}
