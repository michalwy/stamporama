/**
 * The one grammar every retention period in this app is written in (#512, #577, #578).
 *
 * There are two of them now — how long a closed offer keeps its generated listing images, and how
 * long a worked-through batch keeps its retained card scans — and they are deliberately **separate
 * settings that speak one language**. A collector may well keep card scans for ever while purging
 * offer images weekly, so the answers are their own columns; but `0` and `off` mean exactly the same
 * thing on both, because two retention controls on one settings screen where `0` reads opposite ways
 * would be a trap rather than a variation.
 *
 * **The two values are easy to read backwards, so plainly:**
 *
 *  - `off` / `never` (any case) → `null`, which **keeps the bytes for ever**;
 *  - `0` → `0`, which **deletes at the next sweep** (the cutoff is `now`);
 *  - anything else is a number of days.
 *
 * The same grammar arrives from three places for each setting — the collection's own column, then
 * the environment variable, then the built-in default — which is why these take a string rather than
 * reading `process.env` themselves. The `*-retention.ts` modules do the resolving, and each is the
 * only place that names its variable.
 *
 * Each setting brings its own built-in default (`fallbackMs`), because what is safe to delete
 * differs: a generated image can always be made again, and a card scan is a source that cannot.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The canonical way to say *keep for ever* — one of the two spellings the parser accepts, picked so
 * a stored value and a documented one read the same. */
export const RETENTION_FOREVER = "off";

/**
 * Read a configured period into milliseconds, or `null` for keep for ever.
 *
 * Anything unparseable falls back to `fallbackMs` rather than throwing: this runs at boot in a
 * background timer, and a typo in an env var is no reason to start deleting on a schedule nobody
 * asked for — or to take the app down.
 */
export function retentionTtlMs(raw: string | undefined, fallbackMs: number | null): number | null {
  const value = raw?.trim();
  if (!value) return fallbackMs;
  if (/^(off|never)$/i.test(value)) return null;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return fallbackMs;
  return days * DAY_MS;
}

/**
 * Canonicalize what a settings form is about to store, or `undefined` when it is not a value this
 * grammar has.
 *
 * A collection column holds the environment variable's own vocabulary, so nothing here maps between
 * two languages — it only settles the spelling (`Never` → `off`, `" 7 "` → `"7"`) and refuses what
 * {@link retentionTtlMs} would silently swallow as the default. Validation lives at the single write
 * site precisely because the parser is forgiving: a bad value on the read path must never break a
 * sweep, but a bad value typed into a form should be rejected while the collector is still looking
 * at it.
 *
 * Blank is not an error — it is how the form says *no opinion*, and it stores `null`.
 */
export function parseRetentionSetting(raw: string | null | undefined): string | null | undefined {
  const value = raw?.trim();
  if (!value) return null;
  if (/^(off|never)$/i.test(value)) return RETENTION_FOREVER;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return undefined;
  return String(days);
}

/**
 * The instant a thing must have reached its terminal state *before* to be swept, or `null` when the
 * sweep is off. Passed `now` rather than reading the clock, so a sweep and its tests agree on one
 * instant.
 */
export function retentionCutoff(now: Date, ttlMs: number | null): Date | null {
  if (ttlMs === null) return null;
  return new Date(now.getTime() - ttlMs);
}

/** Days, for a sentence — trimmed of the float noise a fractional period would otherwise print. */
export function retentionPeriodWords(ttlMs: number): string {
  const days = ttlMs / DAY_MS;
  return days === 1 ? "1 day" : `${Number(days.toFixed(2))} days`;
}
