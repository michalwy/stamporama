/**
 * Pure rules for reducing the photos of a copy that has left the collection (#2547) — no Prisma, so
 * the period, the departure date and the cutoff are unit-tested on their own.
 *
 * A copy's photos were kept at full resolution for ever, even after the copy was sold, given away
 * in a trade or marked no longer held, while all the collector needs from them by then is to see
 * what it was. So some time after a copy leaves, each of its photos is **reduced, not deleted**: the
 * thumbnail stays and the full-resolution `full` is replaced by one about `REDUCED_MAX_EDGE` on its
 * long side — enough to open it and see the stamp in some detail. Nothing reduced can be restored.
 *
 * This is the third retention period beside the closed-offer images (#512, #577) and the card scans
 * (#578), and speaks their grammar (`retention-ttl.ts`): `off`/`never` keeps for ever, `0` reduces
 * at the next sweep, anything else is days. Its own default, **90 days**, was settled with the
 * collector on 2026-11-15 — the collector asking for it is what lets source bytes go on a schedule
 * (the *unless the collector asks otherwise* of the invariant in `storage-and-jobs.md`).
 */
import {
  parseRetentionSetting,
  retentionCutoff,
  retentionPeriodWords,
  retentionTtlMs,
} from "./retention-ttl";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What an instance that has configured nothing does: reduce a departed copy's photos 90 days after
 * it left (#2547, settled with the collector on 2026-11-15). */
export const DEFAULT_DEPARTED_COPY_PHOTO_TTL_MS: number | null = 90 * DAY_MS;

/** How long a departed copy keeps its full-resolution photos, in milliseconds, or `null` for keep for
 * ever. `departed-copy-photo-retention.ts` resolves the string from the collection, then the
 * environment, and is the only module that names the variable. */
export function departedCopyPhotoTtlMs(raw: string | undefined): number | null {
  return retentionTtlMs(raw, DEFAULT_DEPARTED_COPY_PHOTO_TTL_MS);
}

/** The period in one line — for the boot log and the settings card, like the other two. */
export function describeDepartedCopyPhotoTtl(ttlMs: number | null): string {
  if (ttlMs === null) {
    return "disabled — a copy that has left keeps its full-resolution photos indefinitely";
  }
  if (ttlMs === 0) {
    return "a copy's photos are reduced at the next sweep after it has left";
  }
  return `a copy's photos are reduced ${retentionPeriodWords(ttlMs)} after it has left`;
}

/** What a collection stores in `departedCopyPhotoTtlDays`: `null` = no opinion, defer to the
 * instance; otherwise a canonical value in the shared grammar. */
export type DepartedCopyPhotoTtlSetting = string | null;

/** Canonicalize what the settings form is about to store, or `undefined` when it is not a value the
 * grammar has. Blank is *no opinion* and stores `null`. */
export function parseDepartedCopyPhotoTtlSetting(
  raw: string | null | undefined
): DepartedCopyPhotoTtlSetting | undefined {
  return parseRetentionSetting(raw);
}

/** The instant a copy must have left *before* for its photos to be reduced, or `null` when the
 * sweep is off. */
export function departedCopyPhotoCutoff(now: Date, ttlMs: number | null): Date | null {
  return retentionCutoff(now, ttlMs);
}

/**
 * The three ways a copy leaves, as the sweep reads them. Each list holds the dates of that kind of
 * departure the copy has — normally one entry in one of them and nothing in the others.
 *
 *  - `soldAt`: the sold date of each sale the copy is on. A cancelled sale (#2500) has deleted its
 *    lines, so it is not here, and a copy whose sale was cancelled is simply held again.
 *  - `tradeClosedAt`: the closing of each closed trade that gave the copy away (#644). `null` for a
 *    closed trade with no recorded moment — which the migration backfilling `closedAt` leaves none of.
 *  - `disposedAt`: the day it was marked no longer held (#394).
 */
export interface CopyDepartures {
  soldAt: readonly Date[];
  tradeClosedAt: readonly (Date | null)[];
  disposedAt: Date | null;
}

/**
 * When the copy left, or `null` while it is held — or when a departure it has carries no date, in
 * which case nothing is reduced rather than reckoning from a moment nobody recorded.
 *
 * The **earliest** departure counts: that is the day it left. A copy normally has only one.
 */
export function copyDepartedAt(departures: CopyDepartures): Date | null {
  if (departures.tradeClosedAt.some((d) => d === null)) return null;
  const dates = [
    ...departures.soldAt,
    ...(departures.tradeClosedAt as Date[]),
    ...(departures.disposedAt ? [departures.disposedAt] : []),
  ];
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

/** Whether a copy that left at `departedAt` is due for its photos to be reduced at `cutoff`. */
export function isPhotoReductionDue(departedAt: Date | null, cutoff: Date | null): boolean {
  if (departedAt === null || cutoff === null) return false;
  return departedAt.getTime() <= cutoff.getTime();
}

/** What the copy's screen says about photos that were reduced: the day, so the collector can tell a
 * reduced photo from one that was small to begin with. `null` when none of them was reduced. */
export function describePhotoReduction(reducedAt: Date | string | null): string | null {
  if (reducedAt === null) return null;
  const day = new Date(reducedAt).toISOString().slice(0, 10);
  return `Reduced on ${day}: this copy had left the collection, so only a thumbnail and a smaller photo are kept.`;
}
