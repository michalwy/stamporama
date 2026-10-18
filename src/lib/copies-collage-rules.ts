/**
 * Pure rules for the one-off collage of ticked copies (#2052) — no Prisma, so the Copies list's dialog
 * and the server that renders the images read one module.
 *
 * A collage here is an offer's photo plan with no offer: the ticked copies are composed into sets the
 * way the selection bar's *New offer* shortcuts compose them (#497), and planned and drawn by the
 * offer photo rules. The composition is the collector's choice in the dialog, because the plan reads
 * it — *single photos* (#521) acts only on single-copy sets and *group series* (#1673) only on a
 * multi-copy one, so each packaging has a setting that does nothing without it.
 */

import {
  normalizePhotoSides,
  parseOfferPhotoConfigInput,
  readPhotoConfigFields,
  type OfferCollageValues,
  type OfferPhotoConfigInput,
} from "./offer-photo-config";
import type { PlanChecklistSlot, PlanCopy, PlanSet } from "./offer-photo-plan";
import { sortSetItems } from "./offer-set-order";

/** How the ticked copies are composed into sets — the selection bar's two *New offer* shapes (#497). */
export const COLLAGE_PACKAGINGS = ["one-set", "per-copy"] as const;
export type CollagePackaging = (typeof COLLAGE_PACKAGINGS)[number];

export const COLLAGE_PACKAGING_LABELS: Record<CollagePackaging, string> = {
  "one-set": "As one set — a series or a lot",
  "per-copy": "Each copy on its own",
};

export const DEFAULT_COLLAGE_PACKAGING: CollagePackaging = "one-set";

export function normalizeCollagePackaging(raw: string | null | undefined): CollagePackaging {
  return (COLLAGE_PACKAGINGS as readonly string[]).includes(raw ?? "")
    ? (raw as CollagePackaging)
    : DEFAULT_COLLAGE_PACKAGING;
}

/** One ticked copy as the plan needs it: its catalogue position and the scans its tiles are made of. */
export interface CollageCopy {
  itemId: string;
  catalogSortKey: string | null;
  frontPhotoId: string | null;
  backPhotoId: string | null;
  /** Read only when series are grouped (#1673). */
  checklists?: readonly PlanChecklistSlot[];
}

/** The id of the one set a `one-set` collage is planned as — no set exists, so any stable id does. */
export const COLLAGE_SET_ID = "collage";

/**
 * The ticked copies as the sets the plan is built from, in catalogue order — the order a new offer's
 * copies take until someone reorders them (#306). `one-set` is one multi-copy set; `per-copy` is a
 * single-copy set per copy, ordered the same way.
 */
export function collagePlanSets(copies: readonly CollageCopy[], packaging: CollagePackaging): PlanSet[] {
  const ordered = sortSetItems(
    copies.map(
      (copy): PlanCopy => ({
        itemId: copy.itemId,
        sortOrder: null,
        catalogSortKey: copy.catalogSortKey,
        frontPhotoId: copy.frontPhotoId,
        backPhotoId: copy.backPhotoId,
        ...(copy.checklists ? { checklists: copy.checklists } : {}),
      })
    )
  );
  if (packaging === "one-set") {
    return ordered.length === 0 ? [] : [{ id: COLLAGE_SET_ID, sortOrder: 0, items: ordered }];
  }
  return ordered.map((copy, index) => ({ id: `${COLLAGE_SET_ID}-${index}`, sortOrder: index, items: [copy] }));
}

// ── File names ───────────────────────────────────────────────────────────────

function day(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `collage-2026-10-18.jpg` for a lone image, `collage-2026-10-18-01.jpg`… for several — the day the
 *  collage was made, since there is no offer to name it after, and a number that sorts. */
export function collageFileName(date: Date, index: number, count: number, ext = "jpg"): string {
  if (count <= 1) return `collage-${day(date)}.${ext}`;
  const width = Math.max(2, String(count).length);
  return `collage-${day(date)}-${String(index + 1).padStart(width, "0")}.${ext}`;
}

/** The ZIP several images are downloaded in. */
export function collageArchiveName(date: Date): string {
  return `collage-${day(date)}.zip`;
}

// ── Remembered settings ──────────────────────────────────────────────────────

/** What the dialog remembers between collages: the platform it seeded from, the packaging and the
 *  settings as last used. Kept in the browser, like the other remembered choices of a list. */
export interface RememberedCollageSettings {
  platformId: string;
  packaging: CollagePackaging;
  config: Required<OfferPhotoConfigInput>;
}

function collageFields(prefix: string, c: OfferCollageValues | null): Record<string, string> {
  return {
    [`${prefix}GridMode`]: c?.collageGridMode ?? "",
    [`${prefix}GridShape`]: c?.collageGridShape ?? "",
    [`${prefix}Rows`]: c ? String(c.collageRows) : "",
    [`${prefix}Columns`]: c ? String(c.collageColumns) : "",
    [`${prefix}GapPercent`]: c ? String(c.collageGapPercent) : "",
    [`${prefix}Background`]: c?.collageBackground ?? "",
    [`${prefix}LabelPercent`]: c ? String(c.collageLabelPercent) : "",
  };
}

/**
 * A configuration as the form fields that post it — what `readPhotoConfigFields` reads back — so a
 * remembered configuration is validated by the very parser the dialog's own submit goes through, and
 * anything a later release no longer accepts is dropped rather than trusted.
 */
export function photoConfigFields(config: Required<OfferPhotoConfigInput>): Record<string, string> {
  return {
    photoSides: config.photoSides,
    preferSingles: config.preferSingles ? "on" : "",
    photoLabelLeftTemplate: config.photoLabelLeftTemplate ?? "",
    photoLabelRightTemplate: config.photoLabelRightTemplate ?? "",
    coverSymbols: config.coverSymbols == null ? "" : config.coverSymbols ? "on" : "off",
    groupByChecklist: config.groupByChecklist ? "on" : "",
    ...collageFields("collage", config.collage),
    ...collageFields("groupCollage", config.groupCollage),
  };
}

/** Every part stated: a parse leaves the optional ones out only when they were not posted. */
export function completePhotoConfig(config: OfferPhotoConfigInput): Required<OfferPhotoConfigInput> {
  return {
    ...config,
    photoSides: normalizePhotoSides(config.photoSides),
    coverSymbols: config.coverSymbols ?? null,
    groupByChecklist: config.groupByChecklist ?? false,
    groupCollage: config.groupCollage ?? null,
  };
}

export function serializeCollageSettings(settings: RememberedCollageSettings): string {
  return JSON.stringify(settings);
}

/** The remembered settings, or null where there are none or they no longer parse. */
export function parseRememberedCollageSettings(raw: string | null): RememberedCollageSettings | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { platformId, packaging, config } = value as Record<string, unknown>;
  if (typeof platformId !== "string" || !platformId || !config || typeof config !== "object") return null;
  let fields: Record<string, string>;
  try {
    fields = photoConfigFields(completePhotoConfig(config as OfferPhotoConfigInput));
  } catch {
    return null;
  }
  const parsed = parseOfferPhotoConfigInput(readPhotoConfigFields((name) => fields[name] ?? ""));
  if (!parsed.ok) return null;
  return {
    platformId,
    packaging: normalizeCollagePackaging(typeof packaging === "string" ? packaging : null),
    config: completePhotoConfig(parsed.value),
  };
}
