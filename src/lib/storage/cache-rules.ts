/**
 * The numbers the local storage cache (#591) is governed by, kept pure so they can be read and
 * tested without a database, a disk or a backend.
 *
 * The cache holds copies of **remote** objects so the server does not fetch back bytes it wrote
 * moments ago. What has to be protected is therefore disk, and only disk: the objects are
 * immutable under their key (a photo variant, a sheet's `original` and `view` are written once and
 * never modified), so there is no staleness for a TTL to answer and nothing to invalidate. A TTL
 * could not bound the disk anyway — twenty cards at 200 MB inside one hour is 4 GB whatever the
 * TTL says — while a size cap bounds it by construction.
 */

/** The cap when the operator has said nothing.
 *
 * Fitted to the largest object the app stores rather than to a round number: a card scan retained
 * at 1200 dpi is up to `MAX_UPLOAD_BYTES` (200 MB), so a cap that cannot hold several of them at
 * once plus the copy scans of a collage run would evict the very objects it exists for and be a
 * cache in name only. 2 GB is roughly ten retained cards, or a few thousand copy scans — a working
 * set large enough to cover *the card being cut* and *the offer being tuned* at the same time, and
 * small beside any disk able to hold the collection whose photos it is caching.
 *
 * It is the operator's to change, by #577's rule: the disk is theirs, and a collection has no
 * opinion about it. */
export const DEFAULT_CACHE_MAX_BYTES = 2048 * 1024 * 1024;

/**
 * How far below the cap one eviction pass goes.
 *
 * Eviction runs to a **low-water mark** rather than trimming exactly back to the cap, which is
 * what makes it a sweep instead of something that happens on every write. At the cap, each new
 * 200 MB object would evict on arrival and the pass would run continuously while a card is being
 * cut; a fifth of the cap freed at once is several large objects' worth of headroom, so a run of
 * writes pays for one pass rather than one per write.
 */
export const CACHE_LOW_WATER_FRACTION = 0.8;

/**
 * Read the cap from the environment. `STAMPORAMA_STORAGE_CACHE_MAX_MB`, in whole megabytes.
 *
 * `0`, `off` and `never` all mean **no cache** — the escape hatch for an operator whose disk is
 * the scarce thing, who then pays the remote fetches instead. Anything unparseable falls back to
 * the default rather than throwing: this is read on a hot path, and a typo in an environment
 * variable must not be able to break a write.
 *
 * Deliberately *not* `retention-ttl.ts`'s grammar. That parser answers "how long", where `0` means
 * *sweep at once*; this answers "how much", where `0` means *hold nothing*. The words look alike
 * and the questions are not, so they do not share a parser.
 */
export function cacheMaxBytes(
  env: string | undefined = process.env.STAMPORAMA_STORAGE_CACHE_MAX_MB
): number {
  const raw = env?.trim();
  if (!raw) return DEFAULT_CACHE_MAX_BYTES;
  if (/^(off|never|none|disabled)$/i.test(raw)) return 0;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb < 0) return DEFAULT_CACHE_MAX_BYTES;
  return Math.floor(mb) * 1024 * 1024;
}

/** The size an eviction pass brings the cache down to once it is over the cap. */
export function cacheLowWaterBytes(maxBytes: number): number {
  return Math.floor(maxBytes * CACHE_LOW_WATER_FRACTION);
}

/**
 * How many bytes a pass has to free, given what is held and what the cap is. Zero — never negative
 * — while the cache is inside its cap, which is what lets the caller skip the pass entirely.
 */
export function bytesToEvict(usedBytes: number, maxBytes: number): number {
  if (maxBytes <= 0) return usedBytes;
  if (usedBytes <= maxBytes) return 0;
  return usedBytes - cacheLowWaterBytes(maxBytes);
}

/** The cap in words, for the boot log and for Settings. */
export function describeCacheMax(maxBytes: number): string {
  if (maxBytes <= 0) return "disabled";
  return `${Math.round(maxBytes / (1024 * 1024))} MB`;
}
