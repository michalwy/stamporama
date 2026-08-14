/**
 * Pure rules for the closed-offer photo purge (#512) — no Prisma, so the grace period and the
 * cutoff it produces are unit-tested on their own.
 *
 * The purge exists because a generated image is the one photo in the app that can always be made
 * again: it is rendered from the copies' own scans against the offer's stored photo settings, so
 * deleting the output of a listing that is over costs nothing but the render (#137's principle,
 * which is why `Photo.kind` records how bytes came to exist in the first place). An **original** is
 * never in scope — neither a copy's scan nor the file uploaded straight to the offer for a manual
 * attachment (#313); those are sources, and no rule could make them again.
 *
 * What the grace period is for: a listing closes and then gets looked at. A sale is queried, a
 * withdrawal turns out to be premature and the offer is cloned onto another platform, the images
 * are wanted one more time for a re-post elsewhere. A week is long enough for that to have
 * happened and short enough that a collection's dead listings do not carry their collages forever.
 */

/** Days a closed offer keeps its generated images before the sweep purges them. */
export const DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a closed offer keeps its generated images, in milliseconds, or `null` when the purge is
 * switched off entirely.
 *
 * The grammar is the same shape as the staging-upload TTL (`STAMPORAMA_PHOTO_UPLOAD_TTL_HOURS`)
 * with two additions the storage question needs. **The two are easy to read backwards, so plainly:**
 *
 *  - `off` / `never` (any case) → `null`, which **keeps every image for ever** — an instance with
 *    room to spare, which is exactly what the app did before this existed;
 *  - `0` → `0`, which **purges at the next sweep** (the cutoff is `now`), for a collection that is
 *    short of disk and wants a closed listing's images gone as soon as it is closed.
 *
 * Since #577 the same grammar arrives from three places rather than one — the collection's own
 * `closedOfferPhotoTtlDays`, then the environment variable, then the built-in default — which is
 * why this takes the string rather than reading `process.env` itself. `offer-photo-retention.ts`
 * does the resolving, and is the only place that names the variable.
 *
 * Anything unparseable falls back to the default rather than throwing: this runs at boot in a
 * background timer, and a typo in an env var is no reason to start deleting on a schedule nobody
 * asked for — or to take the app down.
 */
export function closedOfferPhotoTtlMs(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS * DAY_MS;
  if (/^(off|never)$/i.test(value)) return null;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS * DAY_MS;
  return days * DAY_MS;
}

/**
 * How the purge is configured, in one line for the boot log — the counterpart of the storage
 * backend's own startup line (`logStorageStartup`). A deletion that runs on a schedule should say
 * so at boot rather than only when it first fires: an operator reading the logs after an upgrade
 * has to be able to see that generated images are now being deleted, and after how long, without
 * going and finding the default in the docs.
 */
export function describeClosedOfferPhotoTtl(ttlMs: number | null): string {
  if (ttlMs === null) {
    return "disabled — closed offers keep their generated images indefinitely";
  }
  if (ttlMs === 0) {
    return "generated images are deleted at the next sweep after an offer is sold or withdrawn";
  }
  const days = ttlMs / DAY_MS;
  const period = days === 1 ? "1 day" : `${Number(days.toFixed(2))} days`;
  return `generated images are deleted ${period} after an offer is sold or withdrawn`;
}

/** What a collection stores in `closedOfferPhotoTtlDays` (#577): `null` = no opinion, defer to the
 * instance; otherwise a canonical value in the grammar above. */
export type ClosedOfferPhotoTtlSetting = string | null;

/** The canonical way to say *keep for ever* — one of the two spellings the parser accepts, picked
 * so a stored value and a documented one read the same. */
export const CLOSED_OFFER_PHOTO_TTL_FOREVER = "off";

/**
 * Canonicalize what the settings form is about to store (#577), or `undefined` when it is not a
 * value this grammar has.
 *
 * The column holds the environment variable's own vocabulary, so nothing here maps between two
 * languages — it only settles the spelling (`Never` → `off`, `" 7 "` → `"7"`) and refuses what
 * `closedOfferPhotoTtlMs` would silently swallow as the default. Validation lives at this one write
 * site precisely because the parser is forgiving: a bad value on the read path must never break a
 * sweep, but a bad value typed into a form should be rejected while the collector is still looking
 * at it.
 *
 * Blank is not an error — it is how the form says *no opinion*, and it stores `null`.
 */
export function parseClosedOfferPhotoTtlSetting(
  raw: string | null | undefined
): ClosedOfferPhotoTtlSetting | undefined {
  const value = raw?.trim();
  if (!value) return null;
  if (/^(off|never)$/i.test(value)) return CLOSED_OFFER_PHOTO_TTL_FOREVER;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return undefined;
  return String(days);
}

/**
 * The instant a closed offer must have closed *before* to be purged, or `null` when the purge is
 * off. Passed `now` rather than reading the clock, so the sweep and its tests agree on one instant.
 */
export function closedOfferPhotoCutoff(now: Date, ttlMs: number | null): Date | null {
  if (ttlMs === null) return null;
  return new Date(now.getTime() - ttlMs);
}
