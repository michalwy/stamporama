/**
 * Where the departed-copy photo period is resolved (#2547) — the one place that names
 * `STAMPORAMA_DEPARTED_COPY_PHOTO_TTL_DAYS`, so the sweep and every surface that states the period
 * cannot come to disagree about it. The same three steps as `scan-sheet-retention.ts`:
 *
 *  1. the collection's own `departedCopyPhotoTtlDays`, when it sets one;
 *  2. else the environment variable;
 *  3. else the built-in default, 90 days (`DEFAULT_DEPARTED_COPY_PHOTO_TTL_MS`).
 */
import {
  departedCopyPhotoTtlMs,
  type DepartedCopyPhotoTtlSetting,
} from "./departed-copy-photo-rules";

/** What this instance answers for a collection that has no opinion — the environment variable, or
 * `undefined` when it is unset and the built-in default applies. */
export function instanceDepartedCopyPhotoTtlSetting(): string | undefined {
  const raw = process.env.STAMPORAMA_DEPARTED_COPY_PHOTO_TTL_DAYS?.trim();
  return raw ? raw : undefined;
}

/** The instance's own period in milliseconds — what a collection inherits, and what the boot log and
 * the settings screen state as the default. */
export function instanceDepartedCopyPhotoTtlMs(): number | null {
  return departedCopyPhotoTtlMs(instanceDepartedCopyPhotoTtlSetting());
}

/** How long *this collection's* departed copies keep their full-resolution photos, in milliseconds,
 * or `null` for keep for ever. A blank column is read as no opinion. */
export function resolveDepartedCopyPhotoTtlMs(
  collectionSetting: DepartedCopyPhotoTtlSetting | undefined
): number | null {
  const own = collectionSetting?.trim();
  return departedCopyPhotoTtlMs(own ? own : instanceDepartedCopyPhotoTtlSetting());
}
