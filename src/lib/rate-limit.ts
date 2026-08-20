// A small fixed-window rate limiter, in this process's memory (#640).
//
// It exists for the one surface that is reachable **without a session**: the partner's share link and
// the photo route beside it. Everything else in the app is behind sign-in, where the account is the
// limit; a bearer token in a URL is not, and a link that has escaped is a link that can be walked.
//
// Deliberately small and deliberately in-process. There is no Redis in this deployment and adding one
// for this would be a piece of infrastructure to run for a self-hosted app with one collector on it.
// A fixed window over an in-memory map is coarse — a burst on the boundary can get through twice the
// allowance — and that is fine: what this stops is a script guessing token after token, not a precise
// quota. If the app ever runs on more than one node, this becomes per-node and needs replacing; the
// note is here so that is a decision rather than a surprise.
//
// Pinned to `globalThis` for the reason every long-lived object in this app is: `next dev` re-evaluates
// modules on every hot reload, and a fresh map per reload is a limiter that forgets everything each
// time a file is saved.
//
// Deliberately **not** marked `server-only`, unlike its callers: it touches no database, no storage
// and no request context, only a map and a clock. That keeps it testable in the unit suite, where
// there is no shim for that import — and there is nothing here a client bundle could misuse, since a
// counter in a browser tab limits nobody.

interface Window {
  count: number;
  /** Epoch ms at which this window ends and the count resets. */
  resetAt: number;
}

const globalForRateLimit = globalThis as unknown as {
  rateLimitWindows?: Map<string, Window>;
};

const windows = (globalForRateLimit.rateLimitWindows ??= new Map<string, Window>());

/** Windows outlive their usefulness by definition; sweep the expired ones whenever the map has grown
 *  enough to be worth walking, so a long-running instance does not accumulate one entry per address
 *  that ever knocked. */
const SWEEP_AT = 5000;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets — what a `Retry-After` header wants. */
  retryAfter: number;
}

/**
 * Count one hit against `key` and say whether it is allowed.
 *
 * `key` should name **what is being protected and who is knocking**, in that order — the caller
 * composes it, because only the caller knows which of the two matters. The share page keys on the
 * client address so that one partner refreshing does not lock out another.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  if (windows.size >= SWEEP_AT) sweep(now);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

/** Clear every window. For tests, which must not inherit each other's counts. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * The caller's address as best this deployment can tell, for use as part of a limiter key.
 *
 * `x-forwarded-for`'s **first** entry, which is the client as the nearest trusted proxy saw it; this
 * app is served behind one. A header that is absent yields `"unknown"`, and everything without an
 * address then shares one bucket — coarse, but a shared bucket is a limit and no bucket is not.
 *
 * Never used to identify or authorise anybody: an address is trivially forged, so this decides how
 * fast someone may knock and nothing else.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
