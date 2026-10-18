/**
 * Pure rules for a post's *Photo settings…* (#2032): one dialog changing the photo settings of every
 * lot of a Facebook post not yet up. The post holds no settings of its own — each lot keeps its own
 * offer's, as before — so the dialog shows what the lots share, says *Differs by lot* where they do
 * not, and writes only what the collector changed, to every lot.
 *
 * A **setting** here is what the offer's dialog writes as one: each select, label and switch, and
 * each group of collage numbers whole — the numbers are all-or-nothing (#307), so a lot cannot be
 * given one number of a collage it does not carry.
 */

import {
  applyCollagePairing,
  parseOfferPhotoConfigInput,
  type OfferCollageValues,
  type OfferPhotoConfigInput,
  type PhotoConfigParseResult,
} from "./offer-photo-config";

/** An offer's photo configuration with every part stated — what a lot's stored settings read as. */
export type LotPhotoConfig = Required<OfferPhotoConfigInput>;

export const POST_PHOTO_SETTINGS = [
  "coverSymbols",
  "photoSides",
  "photoLabelLeftTemplate",
  "photoLabelRightTemplate",
  "preferSingles",
  "groupByChecklist",
  "groupCollage",
  "collage",
] as const satisfies readonly (keyof LotPhotoConfig)[];
export type PostPhotoSetting = (typeof POST_PHOTO_SETTINGS)[number];

/** One setting across the lots: the value they all share, or `same: false` where they differ. */
export type SharedValue<T> = { same: true; value: T } | { same: false };

export type SharedPhotoSettings = { [K in PostPhotoSetting]: SharedValue<LotPhotoConfig[K]> };

/** What a save writes to every lot: only the settings changed. `collagePairSides` is the pairing of
 *  the collage template picked (#694), applied to each lot's own sides when the sides themselves are
 *  not being written — a both-sides lot follows the template, a front-only one is left alone. */
export type PostPhotoSettingsPatch = Partial<Pick<LotPhotoConfig, PostPhotoSetting>> & {
  collagePairSides?: boolean;
};

function sameCollage(a: OfferCollageValues | null, b: OfferCollageValues | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.collageGridMode === b.collageGridMode &&
    a.collageGridShape === b.collageGridShape &&
    a.collageRows === b.collageRows &&
    a.collageColumns === b.collageColumns &&
    a.collageGapPercent === b.collageGapPercent &&
    a.collageBackground === b.collageBackground &&
    a.collageLabelPercent === b.collageLabelPercent
  );
}

function sameSetting<K extends PostPhotoSetting>(key: K, a: LotPhotoConfig[K], b: LotPhotoConfig[K]): boolean {
  if (key === "collage" || key === "groupCollage") {
    return sameCollage(a as OfferCollageValues | null, b as OfferCollageValues | null);
  }
  return a === b;
}

/** Whether two lots' configurations are the same in every setting the dialog writes. */
export function samePhotoConfig(a: LotPhotoConfig, b: LotPhotoConfig): boolean {
  return POST_PHOTO_SETTINGS.every((key) => sameSetting(key, a[key], b[key]));
}

/** Each setting as the dialog opens on it: shared by every lot, or differing. Needs at least one lot. */
export function sharedPhotoSettings(configs: readonly LotPhotoConfig[]): SharedPhotoSettings {
  if (configs.length === 0) throw new Error("A post has at least one lot.");
  const [first, ...rest] = configs;
  const shared = (key: PostPhotoSetting): SharedValue<unknown> =>
    rest.every((c) => sameSetting(key, c[key], first[key])) ? { same: true, value: first[key] } : { same: false };
  return Object.fromEntries(POST_PHOTO_SETTINGS.map((key) => [key, shared(key)])) as SharedPhotoSettings;
}

/** One lot's configuration with the patch written over it. */
export function applyPostPhotoSettingsPatch(config: LotPhotoConfig, patch: PostPhotoSettingsPatch): LotPhotoConfig {
  const next: LotPhotoConfig = { ...config };
  for (const key of POST_PHOTO_SETTINGS) {
    if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.photoSides === undefined && patch.collagePairSides !== undefined) {
    next.photoSides = applyCollagePairing(config.photoSides, patch.collagePairSides);
  }
  return next;
}

/** Whether a patch writes anything at all. */
export function isEmptyPostPhotoSettingsPatch(patch: PostPhotoSettingsPatch): boolean {
  return POST_PHOTO_SETTINGS.every((key) => patch[key] === undefined) && patch.collagePairSides === undefined;
}

/**
 * What the post's dialog submits, validated: the offer dialog's fields, parsed by the offer dialog's
 * rule, of which only the `changed` settings are kept. A setting left differing travels blank and is
 * not in `changed`, so it is neither validated into anything nor written.
 */
export function parsePostPhotoSettingsPatch(
  raw: Parameters<typeof parseOfferPhotoConfigInput>[0],
  changed: readonly string[],
  collagePairSides: string | null
): PhotoConfigParseResult<PostPhotoSettingsPatch> {
  const parsed = parseOfferPhotoConfigInput(raw);
  if (!parsed.ok) return parsed;
  const keep = new Set(changed);
  const config = parsed.value as LotPhotoConfig;
  const patch: PostPhotoSettingsPatch = {};
  for (const key of POST_PHOTO_SETTINGS) {
    if (keep.has(key)) (patch as Record<string, unknown>)[key] = config[key];
  }
  if (collagePairSides === "1" || collagePairSides === "0") patch.collagePairSides = collagePairSides === "1";
  return { ok: true, value: patch };
}
