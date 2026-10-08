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
 *    template (#307) — plus, for #1673's checklist groups, a switch and a second set of numbers.
 *    Seeded at creation from the platform, then freely editable.
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

/**
 * Which scan sides a listing's photos include, and how the two are arranged.
 *
 * `both` and `paired` (#694) photograph exactly the same scans and differ only in the arrangement:
 * `both` renders a collage of fronts and a separate one of backs, while `paired` renders **one**
 * collage whose every cell holds a copy's front and back side by side. Pairing is therefore a
 * refinement of "both sides", never a fifth thing to choose — which is why it lives here beside
 * them rather than as a flag that could contradict a front-only listing.
 */
export const PHOTO_SIDES = ["front", "back", "both", "paired"] as const;
export type PhotoSides = (typeof PHOTO_SIDES)[number];

/** The side a platform (and so a new offer) starts on — the front alone is the common case. */
export const DEFAULT_PHOTO_SIDES: PhotoSides = "front";

export const PHOTO_SIDES_LABELS: Record<PhotoSides, string> = {
  front: "Front only",
  back: "Back only",
  both: "Front and back",
  paired: "Front and back, paired",
};

/** Narrow a stored/submitted value to a known side, falling back to the default. */
export function normalizePhotoSides(raw: string | null | undefined): PhotoSides {
  const value = (raw ?? "").trim().toLowerCase();
  return (PHOTO_SIDES as readonly string[]).includes(value)
    ? (value as PhotoSides)
    : DEFAULT_PHOTO_SIDES;
}

/** Whether this answer photographs a stamp's two scans at all — `both` and `paired` alike (#694). */
export function includesBothSides(sides: PhotoSides): boolean {
  return sides === "both" || sides === "paired";
}

/**
 * **The offer dialog's template picker rule** (#694): the sides a template a collector has just
 * picked by hand resolves an answer to.
 *
 * The two settings answer **different questions** and this is where they meet: the platform (or the
 * offer) says *which* sides to photograph, the template says *how* the two are arranged. So pairing
 * only ever moves between the two both-sides answers — a paired template turns `both` into `paired`
 * and an unpaired one turns `paired` back into `both` — and a front-only or back-only listing is
 * returned untouched. Neither setting can therefore contradict the other, whichever is edited: a
 * paired template on a front-only platform simply has nothing to arrange.
 *
 * The downgrade is right **here and only here**: picking a template is a deliberate act, so the
 * arrangement follows what was picked. At creation nobody has picked anything, and seeding uses
 * {@link seedCollagePairing} instead — see its doc for why the two differ (#878).
 */
export function applyCollagePairing(sides: PhotoSides, pairSides: boolean): PhotoSides {
  if (!includesBothSides(sides)) return sides;
  return pairSides ? "paired" : "both";
}

/**
 * **The platform's seeding rule** (#308, #878): the sides a *new* offer starts on, given its
 * platform's answer and its platform's default collage template.
 *
 * Same meeting point as {@link applyCollagePairing} and the same upgrade — `both` plus a paired
 * template starts the offer on `paired`, and `front` / `back` are untouched — but **it never
 * downgrades**, which is the whole difference between the two. A platform with no default collage
 * template, or one that does not pair, has said nothing about arrangement, and reading that silence
 * as an explicit "do not pair" is what silently turned a platform set to `paired` into offers on
 * `both` (#878). `paired` therefore stays `paired` unless the collector unpairs the offer itself.
 *
 * This is what the model beside it has always said: `CollageTemplate.pairSides` in `schema.prisma`
 * specifies that seeding *upgrades* rather than overrides. Use this at creation; use
 * `applyCollagePairing` for a template picked by hand.
 */
export function seedCollagePairing(sides: PhotoSides, pairSides: boolean): PhotoSides {
  if (!pairSides) return sides;
  return includesBothSides(sides) ? "paired" : sides;
}

// ── Platform limits ──────────────────────────────────────────────────────────

/** Bounds are sanity rails, not platform knowledge — every real limit fits inside them. */
export const MAX_PHOTO_COUNT_LIMIT = 100;
export const MAX_PHOTO_EDGE_LIMIT = 20000;
/** Sanity ceiling in mebibytes — no platform accepts an image anywhere near this. */
export const MAX_PHOTO_FILE_SIZE_MIB_LIMIT = 1024;

/** Whether a checkbox came back ticked. Browsers post nothing at all for an unticked box, so the
 * absence *is* the answer — the same reading every other checkbox in the app takes. */
function isChecked(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "on" || value === "true" || value === "1";
}

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
  /** Photograph single-copy sets on their own while the platform's photo limit has room (#521),
   * collaging only the tail that does not fit. Off groups them as #309 always did. */
  preferSingles: boolean;
  /** The two per-tile annotations (#312): left and right on one strip. Null means that side is not
   * drawn; both null leaves every tile unlabelled. */
  photoLabelLeftTemplate: string | null;
  photoLabelRightTemplate: string | null;
  collage: OfferCollageValues | null;
  /** Whether symbols are covered on this listing's photos (#1665): null follows the platform, read
   *  live; true or false overrides it. Left out of a write, it is left as it is. */
  coverSymbols?: boolean | null;
  /** Whether a set's copies are grouped by checklist on photos of their own (#1673). Left out of a
   *  write, it is left as it is. */
  groupByChecklist?: boolean;
  /** The collage numbers the checklist groups are laid out with (#1673), copied from a template like
   *  `collage`; null leaves the groups on `collage`. Left out of a write, it is left as it is. */
  groupCollage?: OfferCollageValues | null;
}

/** The cover override as the settings dialog posts it: `on`, `off`, or anything else for *follow
 *  the platform*. */
export function parseCoverSymbolsOverride(raw: string | null | undefined): boolean | null {
  return raw === "on" ? true : raw === "off" ? false : null;
}

/** The collage fields as a form posts them — one group, written together. */
export interface CollageFieldsRaw {
  collageGridMode?: string;
  collageRows: string;
  collageColumns: string;
  collageGapPercent: string;
  collageBackground: string;
  collageLabelPercent: string;
}

/**
 * One group of collage numbers, validated. Every field blank means "none on this offer yet", and
 * anything else must be a complete, valid set — a half-filled collage would render nothing sensible.
 * `prefix` names the group in a message, for an offer carrying two of them (#1673).
 */
function parseCollageValues(
  raw: CollageFieldsRaw,
  prefix = ""
): PhotoConfigParseResult<OfferCollageValues | null> {
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
  if (collageFields.every((f) => !f.trim())) return { ok: true, value: null };

  const collageGridMode = normalizeCollageGridMode(raw.collageGridMode);
  const axisLabels = collageAxisLabels(collageGridMode);

  const rows = parseBoundedInteger(
    raw.collageRows,
    `${prefix}${axisLabels.rows}`,
    MIN_COLLAGE_AXIS,
    MAX_COLLAGE_AXIS
  );
  if (!rows.ok) return rows;

  const columns = parseBoundedInteger(
    raw.collageColumns,
    `${prefix}${axisLabels.columns}`,
    MIN_COLLAGE_AXIS,
    MAX_COLLAGE_AXIS
  );
  if (!columns.ok) return columns;

  const gapPercent = parseBoundedInteger(
    raw.collageGapPercent,
    `${prefix}Gap`,
    MIN_COLLAGE_PERCENT,
    MAX_COLLAGE_PERCENT
  );
  if (!gapPercent.ok) return gapPercent;

  const labelPercent = parseBoundedDecimal(
    raw.collageLabelPercent,
    `${prefix}Label strip`,
    MIN_COLLAGE_LABEL_PERCENT,
    MAX_COLLAGE_LABEL_PERCENT
  );
  if (!labelPercent.ok) return labelPercent;

  const background = normalizeHexColor(raw.collageBackground);
  if (!background) {
    return { ok: false, message: `${prefix}Background must be a hex colour such as #ffffff.` };
  }

  return {
    ok: true,
    value: {
      collageGridMode,
      collageRows: rows.value,
      collageColumns: columns.value,
      collageGapPercent: gapPercent.value,
      collageBackground: background,
      collageLabelPercent: labelPercent.value,
    },
  };
}

/**
 * Validates what the offer's photo-settings dialog submits. Each group of collage numbers arrives
 * whole: every field blank means "no collage numbers on this offer yet", and anything else must be
 * a complete, valid set.
 */
export function parseOfferPhotoConfigInput(
  raw: CollageFieldsRaw & {
    photoSides: string;
    /** A checkbox, so absent is unticked — the form always posts the field it does have. */
    preferSingles?: string;
    photoLabelLeftTemplate: string;
    photoLabelRightTemplate: string;
    /** `on` | `off` | blank (follow the platform), #1665. */
    coverSymbols?: string;
    /** #1673: a checkbox, so absent is unticked. */
    groupByChecklist?: string;
    /** #1673: the group template's numbers, as hidden fields; absent is none. */
    groupCollage?: CollageFieldsRaw;
  }
): PhotoConfigParseResult<OfferPhotoConfigInput> {
  const collage = parseCollageValues(raw);
  if (!collage.ok) return collage;
  const groupCollage = raw.groupCollage
    ? parseCollageValues(raw.groupCollage, "Group collage: ")
    : ({ ok: true, value: null } as const);
  if (!groupCollage.ok) return groupCollage;

  return {
    ok: true,
    value: {
      photoSides: normalizePhotoSides(raw.photoSides),
      preferSingles: isChecked(raw.preferSingles),
      photoLabelLeftTemplate: raw.photoLabelLeftTemplate.trim() || null,
      photoLabelRightTemplate: raw.photoLabelRightTemplate.trim() || null,
      collage: collage.value,
      coverSymbols: parseCoverSymbolsOverride(raw.coverSymbols),
      groupByChecklist: isChecked(raw.groupByChecklist),
      groupCollage: groupCollage.value,
    },
  };
}
