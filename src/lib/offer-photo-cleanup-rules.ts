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
 * Reads `STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS`, the same shape as the staging-upload TTL
 * (`STAMPORAMA_PHOTO_UPLOAD_TTL_HOURS`) with two additions the storage question needs:
 *
 *  - `off` / `never` (any case) disables the sweep — an instance with room to spare keeps every
 *    image it ever rendered, which is exactly what the app did before this existed;
 *  - `0` purges at the next sweep, for an instance that is short of disk and wants a closed
 *    listing's images gone as soon as it is closed.
 *
 * Anything unparseable falls back to the default rather than throwing: this runs at boot in a
 * background timer, and a typo in an env var is no reason to start deleting on a schedule nobody
 * asked for — or to take the app down.
 */
export function closedOfferPhotoTtlMs(
  raw: string | undefined = process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS
): number | null {
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

/**
 * The instant a closed offer must have closed *before* to be purged, or `null` when the purge is
 * off. Passed `now` rather than reading the clock, so the sweep and its tests agree on one instant.
 */
export function closedOfferPhotoCutoff(now: Date, ttlMs: number | null): Date | null {
  if (ttlMs === null) return null;
  return new Date(now.getTime() - ttlMs);
}
