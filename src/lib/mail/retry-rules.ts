/**
 * When a failed send is tried again (#1372).
 *
 * Over about an hour: an outage of a few minutes at the provider must not lose a morning reminder,
 * and a real misconfiguration must still be reported the same morning. The waits grow so the early
 * attempts catch a blip and the late ones a longer outage, without hammering a provider that is down.
 * Attempts start at 0, 1, 5, 15, 30 and 60 minutes; the sixth failure is final.
 *
 * Every failure is retried, a refusal included: a wrong key or an unverified sender fixed within the
 * hour should still deliver, and the hour is the delay the collector agreed to for being told.
 */

/** Minutes to wait after the n-th failed attempt (index 0 = after the first). */
export const MAIL_RETRY_DELAYS_MINUTES: readonly number[] = [1, 4, 10, 15, 30];

export const MAIL_MAX_ATTEMPTS = MAIL_RETRY_DELAYS_MINUTES.length + 1;

/**
 * When to try again after attempt number `attempts` (1-based) failed at `now`, or null when that was
 * the last one and the message is undelivered.
 */
export function nextMailAttemptAt(attempts: number, now: Date): Date | null {
  const delay = MAIL_RETRY_DELAYS_MINUTES[attempts - 1];
  if (delay === undefined) return null;
  return new Date(now.getTime() + delay * 60_000);
}
