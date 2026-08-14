/**
 * Where retained-scan retention is resolved (#578) — the one place that names
 * `STAMPORAMA_SCAN_SHEET_TTL_DAYS`, so the sweep and every surface that states the period in words
 * cannot come to disagree about what it is.
 *
 * Deliberately the same shape as `offer-photo-retention.ts` (#577), down to the three steps, rather
 * than a variation on it — but a **separate column and a separate answer**: a collector may well
 * keep card scans for ever while purging offer images weekly, and a shared setting would make one of
 * those two answers impossible to give.
 *
 * Three steps, in order:
 *
 *  1. the collection's own `scanSheetTtlDays`, when it sets one;
 *  2. else the environment variable;
 *  3. else the built-in default (`DEFAULT_SCAN_SHEET_TTL_MS`) — which is **keep for ever**, because
 *     a card scan is a source and not output. The constant's own comment carries that reasoning.
 *
 * All three speak the **same grammar** as the closed-offer period, parsed by the same function —
 * `off`/`never` keeps for ever, `0` sweeps at the next pass, anything else is days. There is no
 * mapping table here, and deliberately so: a second vocabulary is the thing that drifts.
 */
import { scanSheetTtlMs, type ScanSheetTtlSetting } from "./scan-sheet-cleanup-rules";

/** What this instance answers for a collection that has no opinion — the environment variable, or
 * `undefined` when it is unset and the built-in default is what applies. */
export function instanceScanSheetTtlSetting(): string | undefined {
  const raw = process.env.STAMPORAMA_SCAN_SHEET_TTL_DAYS?.trim();
  return raw ? raw : undefined;
}

/** The instance's own retention period in milliseconds — what a collection inherits, and what the
 * boot log and the settings screen state as the default. */
export function instanceScanSheetTtlMs(): number | null {
  return scanSheetTtlMs(instanceScanSheetTtlSetting());
}

/**
 * How long *this collection's* finished-with batches keep their retained scans, in milliseconds, or
 * `null` for keep for ever.
 *
 * A blank column is read as no opinion rather than as an empty string, so a row that somehow holds
 * one still inherits instead of quietly overriding the operator's setting with the built-in default.
 */
export function resolveScanSheetTtlMs(
  collectionSetting: ScanSheetTtlSetting | undefined
): number | null {
  const own = collectionSetting?.trim();
  return scanSheetTtlMs(own ? own : instanceScanSheetTtlSetting());
}
