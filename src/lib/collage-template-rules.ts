/**
 * Pure validation for collage templates (#307) — no Prisma, so it is unit-testable and can be
 * reused by the offer-side form once the offer carries its own copy of these numbers (#308).
 *
 * Sizes are **percentages**, never pixels (#312). A collector cannot pick a pixel number without
 * knowing the scan DPI *and* how far the platform's limits will shrink the finished collage — and
 * neither is knowable when the template is written.
 *
 * The two percentages are shares of different things, and the renderer (#310) resolves them apart:
 * the **gap** against the collage's median tile height, because spacing between stamps belongs to
 * the stamps; the **label strip** against the finished image's longest edge (#337), because every
 * image of a listing is scaled to the same platform limit, and that is the only measure that makes
 * captions come out the same size on all of them.
 */

/** Capacity bounds. A 1×1 template is the single-stamp case and is deliberately allowed. */
export const MIN_COLLAGE_AXIS = 1;
export const MAX_COLLAGE_AXIS = 20;

/**
 * How a template's two numbers are read (#413).
 *
 * - `fixed` — `columns` is both the bound and the shape: every row is filled to that width and the
 *   last one is short.
 * - `auto` — the two are *bounds only* (max rows, max columns) and the renderer solves the width
 *   from the tiles actually on the image. The product stays the capacity either way, so what an
 *   image holds (#309) does not depend on the mode; only its shape does.
 *
 * Auto exists because the collector's material decides the numbers and the offer decides the count:
 * a template that lays nine small definitives out three across produced a 4 + 1 image for a set of
 * five, and the fix was to edit the template between offers.
 */
export const COLLAGE_GRID_MODES = ["fixed", "auto"] as const;
export type CollageGridMode = (typeof COLLAGE_GRID_MODES)[number];

/** What a new template starts as. Fixed is what every template written before #413 does, and the
 * toggle sits right beside the two numbers. */
export const DEFAULT_COLLAGE_GRID_MODE: CollageGridMode = "fixed";

export const COLLAGE_GRID_MODE_LABELS: Record<CollageGridMode, string> = {
  fixed: "Fixed grid",
  auto: "Automatic",
};

/**
 * Narrows a stored or submitted value to a known mode. Null — an offer prepared before the mode
 * existed, or a form that did not send the field — reads as `fixed`, which is what those offers
 * have always rendered as.
 */
export function normalizeCollageGridMode(raw: string | null | undefined): CollageGridMode {
  const value = (raw ?? "").trim().toLowerCase();
  return (COLLAGE_GRID_MODES as readonly string[]).includes(value)
    ? (value as CollageGridMode)
    : DEFAULT_COLLAGE_GRID_MODE;
}

/** What the two numbers are called in the mode they are being read in — the same words the forms
 * label them with, so a validation message names the field the collector is looking at. */
export function collageAxisLabels(mode: CollageGridMode): { rows: string; columns: string } {
  return mode === "auto"
    ? { rows: "Max rows", columns: "Max columns" }
    : { rows: "Rows", columns: "Columns" };
}

/** Bounds for `gapPercent`, in percent of the stamp height. 0 means no gap. */
export const MIN_COLLAGE_PERCENT = 0;
export const MAX_COLLAGE_PERCENT = 100;

/** Bounds for `labelPercent`, in percent of the finished image's **longest edge** (#337) — a
 * different measure from the gap's, so a different ceiling. 0 means no strip at all. A caption a
 * quarter of the image tall is already past absurd, and on a multi-row collage the layout has to
 * refuse it anyway (a strip per row cannot each be a quarter of the page). */
export const MIN_COLLAGE_LABEL_PERCENT = 0;
export const MAX_COLLAGE_LABEL_PERCENT = 25;

/** Decimal places allowed on the label strip. Measured against the whole image, the band between
 * "too small to read" and "shouting over the stamps" is about two percent wide, and whole numbers
 * cannot land inside it: 1 reads well where 2 is already too much. Steps of a tenth give that band
 * twenty settings, which is enough to stop tuning. */
export const COLLAGE_LABEL_DECIMALS = 1;
export const COLLAGE_LABEL_STEP = 0.1;

/**
 * Whether one cell holds a stamp's **two scans side by side** rather than a single scan (#694).
 *
 * The arrangement belongs to the template because it is part of the look a collector settles on and
 * reuses — "my paired layout" is a template, not a decision to retake per listing. What it cannot
 * decide is *which* sides get photographed: that is the offer's (and the platform's) answer, and
 * pairing only refines it. `applyCollagePairing` in `offer-photo-config.ts` is where the two meet.
 *
 * Off for a new template, which is what every template written before this renders as.
 */
export const DEFAULT_COLLAGE_PAIR_SIDES = false;

/** What a new template starts at: a comfortable margin, and a caption at a percent and a half of the
 * image — the middle of the band above, readable on a marketplace listing at any output size. */
export const DEFAULT_COLLAGE_GAP_PERCENT = 5;
export const DEFAULT_COLLAGE_LABEL_PERCENT = 1.5;

/**
 * What a new template's canvas starts at (#381). **Black**, not white: a stamp scan carries its own
 * pale margins, so on a white canvas the tile's edge dissolves into the background and a collage
 * reads as stamps floating in nothing. Black keeps every tile's outline, and the label ink follows
 * automatically — `labelInkColor` picks white or black off the background's luminance, so a caption
 * stays readable whichever colour a collector settles on.
 *
 * It is only a *starting* value: the picker sits beside it in the template form, and an existing
 * template keeps whatever colour it was written with.
 */
export const DEFAULT_COLLAGE_BACKGROUND = "#000000";

export interface CollageTemplateInput {
  name: string;
  /** How `rows` / `columns` are read (#413): an exact grid, or bounds the renderer solves within. */
  gridMode: CollageGridMode;
  /** Whether a cell holds a stamp's front and back side by side (#694). A cell, not an image: the
   * grid above is unchanged by it — each cell is simply wider. */
  pairSides: boolean;
  rows: number;
  columns: number;
  /** Space between tiles, rows and around the collage, as a percent of the stamp height. */
  gapPercent: number;
  background: string;
  /** Height of each tile's label strip — and so the size of its caption — as a percent of the
   * finished image's longest edge (#337). */
  labelPercent: number;
}

export type CollageTemplateParseResult =
  | { ok: true; value: CollageTemplateInput }
  | { ok: false; message: string };

/** Whether a checkbox came back ticked. Browsers post nothing at all for an unticked box, so the
 * absence *is* the answer — the same reading every other checkbox in the app takes. */
function isChecked(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "on" || value === "true" || value === "1";
}

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

/** Parses a required number within bounds, allowing up to {@link COLLAGE_LABEL_DECIMALS} decimal
 * places and either separator — a collector typing `1,5` means the same as `1.5`, as everywhere else
 * a decimal is entered. Exported for the offer-side photo configuration (#308). */
export function parseBoundedDecimal(raw: string, label: string, min: number, max: number):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return { ok: false, message: `${label} is required.` };
  if (!new RegExp(`^-?\\d+(\\.\\d{1,${COLLAGE_LABEL_DECIMALS}})?$`).test(trimmed)) {
    return {
      ok: false,
      message: `${label} must be a number with at most ${COLLAGE_LABEL_DECIMALS} decimal place.`,
    };
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
  gridMode?: string;
  /** A checkbox, so absent is unticked (#694) — the form always posts the field it does have. */
  pairSides?: string;
  rows: string;
  columns: string;
  gapPercent: string;
  background: string;
  labelPercent: string;
}): CollageTemplateParseResult {
  const name = raw.name.trim();
  if (!name) return { ok: false, message: "Name is required." };

  const gridMode = normalizeCollageGridMode(raw.gridMode);
  const axisLabels = collageAxisLabels(gridMode);

  const rows = parseBoundedInteger(raw.rows, axisLabels.rows, MIN_COLLAGE_AXIS, MAX_COLLAGE_AXIS);
  if (!rows.ok) return rows;

  const columns = parseBoundedInteger(
    raw.columns,
    axisLabels.columns,
    MIN_COLLAGE_AXIS,
    MAX_COLLAGE_AXIS
  );
  if (!columns.ok) return columns;

  const gapPercent = parseBoundedInteger(
    raw.gapPercent,
    "Gap",
    MIN_COLLAGE_PERCENT,
    MAX_COLLAGE_PERCENT
  );
  if (!gapPercent.ok) return gapPercent;

  const labelPercent = parseBoundedDecimal(
    raw.labelPercent,
    "Label strip",
    MIN_COLLAGE_LABEL_PERCENT,
    MAX_COLLAGE_LABEL_PERCENT
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
      gridMode,
      pairSides: isChecked(raw.pairSides),
      rows: rows.value,
      columns: columns.value,
      gapPercent: gapPercent.value,
      background,
      labelPercent: labelPercent.value,
    },
  };
}
