/**
 * Where closed-offer photo retention is resolved (#577) — the one place that names
 * `STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS`, so the sweep and every surface that states the period
 * in words cannot come to disagree about what it is.
 *
 * Retention moved onto the collection because it is a question about the collector's own data
 * rather than about the instance's plumbing: a working collection and an archive of something
 * finished want different answers, and an environment variable can only give one. The variable
 * stays as the **instance default** rather than being migrated away from — an operator who
 * configured one keeps exactly what they configured, and still moves every collection that never
 * stated its own answer.
 *
 * Three steps, in order:
 *
 *  1. the collection's own `closedOfferPhotoTtlDays`, when it sets one;
 *  2. else the environment variable;
 *  3. else the built-in default (`DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS`, seven days).
 *
 * All three speak the **same grammar**, parsed by the same function — `off`/`never` keeps images
 * for ever, `0` purges at the next sweep, anything else is days. There is no mapping table here,
 * and deliberately so: a second vocabulary is the thing that drifts.
 */
import {
  closedOfferPhotoTtlMs,
  type ClosedOfferPhotoTtlSetting,
} from "./offer-photo-cleanup-rules";

/** What this instance answers for a collection that has no opinion — the environment variable, or
 * `undefined` when it is unset and the built-in default is what applies. */
export function instanceClosedOfferPhotoTtlSetting(): string | undefined {
  const raw = process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS?.trim();
  return raw ? raw : undefined;
}

/** The instance's own retention period in milliseconds — what a collection inherits, and what the
 * boot log and the settings screen state as the default. */
export function instanceClosedOfferPhotoTtlMs(): number | null {
  return closedOfferPhotoTtlMs(instanceClosedOfferPhotoTtlSetting());
}

/**
 * How long *this collection's* closed offers keep their generated images, in milliseconds, or
 * `null` for keep for ever.
 *
 * A blank column is read as no opinion rather than as an empty string, so a row that somehow holds
 * one still inherits instead of quietly overriding the operator's setting with the built-in
 * default.
 */
export function resolveClosedOfferPhotoTtlMs(
  collectionSetting: ClosedOfferPhotoTtlSetting | undefined
): number | null {
  const own = collectionSetting?.trim();
  return closedOfferPhotoTtlMs(own ? own : instanceClosedOfferPhotoTtlSetting());
}
