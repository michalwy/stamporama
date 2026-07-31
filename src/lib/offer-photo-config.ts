/**
 * Pure rules for offer photo configuration (#308) — no Prisma, so both the platform (contact) form
 * and the offer's photo-settings dialog validate through the same module.
 *
 * Configuration sits on two levels:
 *
 *  - **Platform limits** — what the platform physically accepts (max photos, longest edge, file
 *    size). All optional (`null` = no limit) and never seeded onto an offer: they describe the
 *    platform, so the renderer reads them live (#310).
 *  - **Offer configuration** — what this listing's photos should look like: which scan sides to
 *    include, the two per-tile label templates (#312) and the collage numbers copied from a collage
 *    template (#307). Seeded at creation from the platform, then freely editable.
 *
 * The collage numbers are all-or-nothing: an offer either carries a complete set copied from a
 * template, or none at all (the platform had no default template and none has been picked yet).
 */

import {
  collageAxisLabels,
  normalizeCollageGridMode,
  type CollageGridMode,
  MAX_COLLAGE_AXIS,
  MAX_COLLAGE_LABEL_PERCENT,
  MAX_COLLAGE_PERCENT,
  MIN_COLLAGE_AXIS,
  MIN_COLLAGE_LABEL_PERCENT,
  MIN_COLLAGE_PERCENT,
  normalizeHexColor,
  parseBoundedDecimal,
  parseBoundedInteger,
} from "./collage-template-rules";

/** Which scan sides a listing's photos include. */
export const PHOTO_SIDES = ["front", "back", "both"] as const;
export type PhotoSides = (typeof PHOTO_SIDES)[number];

/** The side a platform (and so a new offer) starts on — the front alone is the common case. */
export const DEFAULT_PHOTO_SIDES: PhotoSides = "front";

export const PHOTO_SIDES_LABELS: Record<PhotoSides, string> = {
  front: "Front only",
  back: "Back only",
  both: "Front and back",
};

/** Narrow a stored/submitted value to a known side, falling back to the default. */
export function normalizePhotoSides(raw: string | null | undefined): PhotoSides {
  const value = (raw ?? "").trim().toLowerCase();
  return (PHOTO_SIDES as readonly string[]).includes(value)
    ? (value as PhotoSides)
    : DEFAULT_PHOTO_SIDES;
}

// ── Platform limits ──────────────────────────────────────────────────────────

/** Bounds are sanity rails, not platform knowledge — every real limit fits inside them. */
export const MAX_PHOTO_COUNT_LIMIT = 100;
export const MAX_PHOTO_EDGE_LIMIT = 20000;
/** Sanity ceiling in mebibytes — no platform accepts an image anywhere near this. */
export const MAX_PHOTO_FILE_SIZE_MIB_LIMIT = 1024;

/** A platform's hard technical limits. Null means "no limit stated". */
export interface PlatformPhotoLimits {
  maxPhotos: number | null;
  maxPhotoEdge: number | null;
  maxPhotoFileSizeMib: number | null;
}

export type PhotoConfigParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Parses an optional bounded integer: blank is a valid "no limit". */
function parseOptionalInteger(
  raw: string,
  label: string,
  min: number,
  max: number
): PhotoConfigParseResult<number | null> {
  if (!raw.trim()) return { ok: true, value: null };
  return parseBoundedInteger(raw, label, min, max);
}

/** Validates the raw strings the contact form submits for a platform's photo limits. */
export function parsePlatformPhotoLimits(raw: {
  maxPhotos: string;
  maxPhotoEdge: string;
  maxPhotoFileSizeMib: string;
}): PhotoConfigParseResult<PlatformPhotoLimits> {
  const maxPhotos = parseOptionalInteger(raw.maxPhotos, "Max photos", 1, MAX_PHOTO_COUNT_LIMIT);
  if (!maxPhotos.ok) return maxPhotos;

  const maxPhotoEdge = parseOptionalInteger(
    raw.maxPhotoEdge,
    "Max longest edge",
    1,
    MAX_PHOTO_EDGE_LIMIT
  );
  if (!maxPhotoEdge.ok) return maxPhotoEdge;

  const maxPhotoFileSizeMib = parseOptionalInteger(
    raw.maxPhotoFileSizeMib,
    "Max file size",
    1,
    MAX_PHOTO_FILE_SIZE_MIB_LIMIT
  );
  if (!maxPhotoFileSizeMib.ok) return maxPhotoFileSizeMib;

  return {
    ok: true,
    value: {
      maxPhotos: maxPhotos.value,
      maxPhotoEdge: maxPhotoEdge.value,
      maxPhotoFileSizeMib: maxPhotoFileSizeMib.value,
    },
  };
}

// ── Offer configuration ──────────────────────────────────────────────────────

/** The collage numbers an offer carries, copied from a collage template (#307). The two sizes are
 * percentages of the stamp height, not pixels (#312) — see `collage-template-rules.ts`. */
export interface OfferCollageValues {
  /** How the two numbers below are read (#413). An offer prepared before the mode existed stores
   * null and reads as `fixed`, so this side of the group is never blank once the group is there. */
  collageGridMode: CollageGridMode;
  collageRows: number;
  collageColumns: number;
  collageGapPercent: number;
  collageBackground: string;
  collageLabelPercent: number;
}

/** An offer's own photo configuration. `collage` is null while no template has been copied in. */
export interface OfferPhotoConfigInput {
  photoSides: PhotoSides;
  /** The two per-tile annotations (#312): left and right on one strip. Null means that side is not
   * drawn; both null leaves every tile unlabelled. */
  photoLabelLeftTemplate: string | null;
  photoLabelRightTemplate: string | null;
  collage: OfferCollageValues | null;
}

/**
 * Validates what the offer's photo-settings dialog submits. The collage numbers arrive as one
 * group: every field blank means "no collage numbers on this offer yet", and anything else must be
 * a complete, valid set — a half-filled collage would render nothing sensible.
 */
export function parseOfferPhotoConfigInput(raw: {
  photoSides: string;
  photoLabelLeftTemplate: string;
  photoLabelRightTemplate: string;
  collageGridMode?: string;
  collageRows: string;
  collageColumns: string;
  collageGapPercent: string;
  collageBackground: string;
  collageLabelPercent: string;
}): PhotoConfigParseResult<OfferPhotoConfigInput> {
  const photoSides = normalizePhotoSides(raw.photoSides);
  const photoLabelLeftTemplate = raw.photoLabelLeftTemplate.trim() || null;
  const photoLabelRightTemplate = raw.photoLabelRightTemplate.trim() || null;

  // The mode is deliberately **not** one of the fields that decide whether a collage is configured
  // at all: it is a toggle, so it always carries a value, and counting it would make "no collage on
  // this offer yet" unsayable — the same reason the background travels in a hidden field.
  const collageFields = [
    raw.collageRows,
    raw.collageColumns,
    raw.collageGapPercent,
    raw.collageBackground,
    raw.collageLabelPercent,
  ];
  if (collageFields.every((f) => !f.trim())) {
    return {
      ok: true,
      value: { photoSides, photoLabelLeftTemplate, photoLabelRightTemplate, collage: null },
    };
  }

  const collageGridMode = normalizeCollageGridMode(raw.collageGridMode);
  const axisLabels = collageAxisLabels(collageGridMode);

  const rows = parseBoundedInteger(
    raw.collageRows,
    axisLabels.rows,
    MIN_COLLAGE_AXIS,
    MAX_COLLAGE_AXIS
  );
  if (!rows.ok) return rows;

  const columns = parseBoundedInteger(
    raw.collageColumns,
    axisLabels.columns,
    MIN_COLLAGE_AXIS,
    MAX_COLLAGE_AXIS
  );
  if (!columns.ok) return columns;

  const gapPercent = parseBoundedInteger(
    raw.collageGapPercent,
    "Gap",
    MIN_COLLAGE_PERCENT,
    MAX_COLLAGE_PERCENT
  );
  if (!gapPercent.ok) return gapPercent;

  const labelPercent = parseBoundedDecimal(
    raw.collageLabelPercent,
    "Label strip",
    MIN_COLLAGE_LABEL_PERCENT,
    MAX_COLLAGE_LABEL_PERCENT
  );
  if (!labelPercent.ok) return labelPercent;

  const background = normalizeHexColor(raw.collageBackground);
  if (!background) {
    return { ok: false, message: "Background must be a hex colour such as #ffffff." };
  }

  return {
    ok: true,
    value: {
      photoSides,
      photoLabelLeftTemplate,
      photoLabelRightTemplate,
      collage: {
        collageGridMode,
        collageRows: rows.value,
        collageColumns: columns.value,
        collageGapPercent: gapPercent.value,
        collageBackground: background,
        collageLabelPercent: labelPercent.value,
      },
    },
  };
}
