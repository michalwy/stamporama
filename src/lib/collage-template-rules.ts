/**
 * Pure validation for collage templates (#307) — no Prisma, so it is unit-testable and can be
 * reused by the offer-side form once the offer carries its own copy of these numbers (#308).
 *
 * All numeric render values are **output pixels**: stamps are scanned at a constant DPI, so the
 * renderer (#310) already works in a pixel space that carries true relative sizes.
 */

/** Capacity bounds. A 1×1 template is the single-stamp case and is deliberately allowed. */
export const MIN_COLLAGE_AXIS = 1;
export const MAX_COLLAGE_AXIS = 20;

/** Pixel bounds shared by `gap` and `labelStripHeight`. 0 means "none". */
export const MIN_COLLAGE_PIXELS = 0;
export const MAX_COLLAGE_PIXELS = 2000;

export const DEFAULT_COLLAGE_BACKGROUND = "#ffffff";

export interface CollageTemplateInput {
  name: string;
  rows: number;
  columns: number;
  gap: number;
  background: string;
  labelStripHeight: number;
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
  gap: string;
  background: string;
  labelStripHeight: string;
}): CollageTemplateParseResult {
  const name = raw.name.trim();
  if (!name) return { ok: false, message: "Name is required." };

  const rows = parseBoundedInteger(raw.rows, "Rows", MIN_COLLAGE_AXIS, MAX_COLLAGE_AXIS);
  if (!rows.ok) return rows;

  const columns = parseBoundedInteger(raw.columns, "Columns", MIN_COLLAGE_AXIS, MAX_COLLAGE_AXIS);
  if (!columns.ok) return columns;

  const gap = parseBoundedInteger(raw.gap, "Gap", MIN_COLLAGE_PIXELS, MAX_COLLAGE_PIXELS);
  if (!gap.ok) return gap;

  const labelStripHeight = parseBoundedInteger(
    raw.labelStripHeight,
    "Label strip height",
    MIN_COLLAGE_PIXELS,
    MAX_COLLAGE_PIXELS
  );
  if (!labelStripHeight.ok) return labelStripHeight;

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
      gap: gap.value,
      background,
      labelStripHeight: labelStripHeight.value,
    },
  };
}
