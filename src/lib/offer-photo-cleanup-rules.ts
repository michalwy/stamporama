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
import {
  RETENTION_FOREVER,
  parseRetentionSetting,
  retentionCutoff,
  retentionPeriodWords,
  retentionTtlMs,
} from "./retention-ttl";

/** Days a closed offer keeps its generated images before the sweep purges them. */
export const DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a closed offer keeps its generated images, in milliseconds, or `null` when the purge is
 * switched off entirely.
 *
 * The grammar itself lives in `retention-ttl.ts` and is shared with the scan-sheet retention that
 * followed this one (#578) — `off` / `never` keeps for ever, `0` purges at the next sweep, anything
 * else is days. One parser for both, because two retention settings on one screen where `0` means
 * opposite things would be a trap; what is this module's own is only the **default** applied when
 * nothing is configured, since what is safe to delete differs between a generated image and a source.
 *
 * Since #577 the same grammar arrives from three places rather than one — the collection's own
 * `closedOfferPhotoTtlDays`, then the environment variable, then the built-in default — which is
 * why this takes the string rather than reading `process.env` itself. `offer-photo-retention.ts`
 * does the resolving, and is the only place that names the variable.
 */
export function closedOfferPhotoTtlMs(raw: string | undefined): number | null {
  return retentionTtlMs(raw, DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS * DAY_MS);
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
    return "generated images are deleted at the next sweep after the sale is delivered, or the offer withdrawn";
  }
  return `generated images are deleted ${retentionPeriodWords(ttlMs)} after the sale is delivered, or the offer withdrawn`;
}

/** What a collection stores in `closedOfferPhotoTtlDays` (#577): `null` = no opinion, defer to the
 * instance; otherwise a canonical value in the grammar above. */
export type ClosedOfferPhotoTtlSetting = string | null;

/** The canonical way to say *keep for ever* — one of the two spellings the parser accepts, picked
 * so a stored value and a documented one read the same. */
export const CLOSED_OFFER_PHOTO_TTL_FOREVER = RETENTION_FOREVER;

/** Canonicalize what the settings form is about to store (#577), or `undefined` when it is not a
 * value this grammar has — the shared write-site validation, named for the setting it guards. */
export function parseClosedOfferPhotoTtlSetting(
  raw: string | null | undefined
): ClosedOfferPhotoTtlSetting | undefined {
  return parseRetentionSetting(raw);
}

/**
 * The instant a closed offer must have closed *before* to be purged, or `null` when the purge is
 * off. Passed `now` rather than reading the clock, so the sweep and its tests agree on one instant.
 */
export function closedOfferPhotoCutoff(now: Date, ttlMs: number | null): Date | null {
  return retentionCutoff(now, ttlMs);
}

/** The fulfilment status a sale is in once its parcel has arrived — shown as *Delivered* (#191). */
const DELIVERED_SALE_STATUS = "received";

/** One sale a sold offer went into, as {@link closedOfferPhotoClockStart} reads it. */
export interface ClosedOfferSale {
  /** `Sale.status`. */
  status: string;
  /** When the sale was last marked *Delivered* — its latest `received` status event — or null when
   * no such event is recorded. */
  deliveredAt: Date | null;
}

/**
 * When a closed offer's retention period starts, or `null` while it has not started (#2457).
 *
 * A **sold** offer that went into one or more sales waits for every one of them to be *Delivered*:
 * a buyer who never pays has the order cancelled and the offer comes back, and a cash-on-delivery
 * parcel can be returned, and either way the images would only be made again (#2317). Sent is not
 * enough for that second reason. The clock then runs from the **latest** delivery — an offer with
 * quantity sold to several buyers is done when the last parcel arrives — and a sale moved back from
 * Delivered stops it again, since what is read is the status it is in now. There is no fallback:
 * a sale never marked Delivered keeps its offers' images. The clock never starts before the offer
 * itself closed.
 *
 * A **withdrawn** offer, and a sold one with no sale behind it, keep #512's rule: the period runs
 * from `closedAt`. A delivered sale with no recorded event (none is expected) falls back on it too.
 */
export function closedOfferPhotoClockStart(offer: {
  state: string;
  closedAt: Date | null;
  sales: readonly ClosedOfferSale[];
}): Date | null {
  const { closedAt } = offer;
  if (closedAt == null) return null;
  if (offer.state !== "sold" || offer.sales.length === 0) return closedAt;
  let start = closedAt;
  for (const sale of offer.sales) {
    if (sale.status !== DELIVERED_SALE_STATUS) return null;
    if (sale.deliveredAt && sale.deliveredAt > start) start = sale.deliveredAt;
  }
  return start;
}
