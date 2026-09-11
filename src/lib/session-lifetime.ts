// How long being signed in lasts here, and what the sign-in screen says when a session ended
// without the collector asking (#1175).
//
// **The rule is that ordinary use never signs the collector out.** This is an instance one person
// runs for their own collection: there is no inactivity window and no fixed lifetime, restarting
// the app is ordinary use, and the only thing the collector can do to end a session is sign out.
// Changing what a session is built on — rotating `BETTER_AUTH_SECRET`, moving the instance to
// another address, replacing its database — does end every session, and that is the honest
// outcome rather than the defect.
//
// **The defect was a lease nobody renewed.** Better Auth writes the session cookie exactly once,
// at sign-in, with `Max-Age = session.expiresIn` — seven days by default. It re-issues the cookie
// from `getSession`, but only onto a response: `auth.api.getSession({ headers })` called from a
// server component or a server action returns the session and **discards** the `Set-Cookie` it
// produced, and nothing in this app ever calls Better Auth through a path that would apply it
// (there is no `authClient.useSession()` anywhere and no `nextCookies()` plugin). The stored row's
// `expiresAt` slid; the cookie in the browser did not. Seven days after signing in, mid-task, the
// browser simply stopped sending it.
//
// So the fix has two halves and needs both. This module holds the numbers and the pure rules;
// `src/middleware.ts` renews the cookie on every request the collector makes, and `src/lib/auth.ts`
// takes the spans below.

/**
 * The session's lifetime, in seconds — ten years.
 *
 * **This is not a policy, it is the largest number the transport can carry.** A cookie that is to
 * survive closing the browser must state *some* expiry, and a stored session row has an
 * `expiresAt` column that is not nullable, so "never" has to be spelled as a date. Ten years is far
 * enough out that nothing in ordinary use reaches it, and it is re-stated on every request
 * (`src/middleware.ts`), so the span that actually applies is ten years from the collector's **last
 * visit** rather than from their sign-in.
 *
 * Browsers cap a cookie's own lifetime at 400 days regardless of what the server asks for, which is
 * precisely why the renewal is not optional: without it this number would silently become thirteen
 * months and the defect would come back, rarer and harder to recognise.
 */
export const SESSION_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60;

/**
 * How stale the stored session row may get before Better Auth slides its `expiresAt` — thirty days.
 *
 * Better Auth refreshes a session when `expiresAt - expiresIn + updateAge <= now`, i.e. once this
 * long has passed since the last refresh, so this is a write frequency and nothing else: the
 * collector never feels it. It is thirty days rather than the default day because the refresh is a
 * database write performed while a server component renders, and with a ten-year `expiresIn` there
 * is nothing urgent about it.
 */
export const SESSION_REFRESH_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The two names Better Auth's session cookie can have here, and the only two.
 *
 * The `__Secure-` prefix is added when the instance's `baseURL` is `https://` (or when `NODE_ENV`
 * is production and no `baseURL` is set), so which one is in play is a deployment fact. Probing for
 * both rather than re-deriving the rule keeps `src/middleware.ts` free of configuration: the name
 * the browser sent is itself the answer, and it also says whether the cookie is `Secure`.
 */
export const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

/** Whether a cookie of this name must be re-issued with `Secure` — read off the name itself. */
export function isSecureSessionCookieName(name: string): boolean {
  return name.startsWith("__Secure-");
}

/**
 * The session token inside a signed cookie value, or `null` when the value is not one.
 *
 * Better Auth signs the cookie as `` `${token}.${base64Signature}` ``. The token is Better Auth's
 * `generateId(32)` — letters and digits only — and a base64 signature contains no `.` either, so
 * the first dot is the boundary and there is no ambiguity to resolve. This deliberately does **not**
 * check the signature: its caller is the sign-in screen working out *why* a cookie was refused, and
 * a signature that no longer verifies is one of the answers it is looking for.
 */
export function sessionTokenFromCookie(value: string): string | null {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  return value.slice(0, dot);
}

/** Why a session the browser still holds is no longer accepted by this instance. */
export type SessionEndReason = "settings-changed" | "sessions-cleared" | "expired";

/**
 * Why the instance refused a session cookie, given what its token resolves to in the database.
 *
 * Three cases, and they are distinguishable because the cookie carries the token in the clear:
 *
 * - **No row.** The session this browser holds is not one this database knows. Replacing or
 *   resetting the database is what usually does that, and the sentence says so as the likely cause
 *   rather than as a finding — a deleted row is a deleted row, and one other thing can produce one.
 *   `src/proxy.ts` re-leases the cookie on every request, so a request already in flight when the
 *   collector signs out can put the cookie back a moment after `/api/auth/sign-out` deleted its
 *   row. Nothing is reachable with it and nothing is at risk; the browser is simply holding a
 *   receipt for a session that is gone, which is exactly what this reason describes.
 * - **A row that has expired.** Only reachable for a session minted before this instance took the
 *   lifetime above; kept because it is the truthful thing to say when it happens.
 * - **A row that is live.** The token names a real, unexpired session and the instance still would
 *   not take the cookie, so what failed is the cookie's signature or its name — which is the
 *   authentication secret having been rotated, or the instance having moved between `http` and
 *   `https` (the `__Secure-` prefix goes with the scheme).
 *
 * One case has no sentence at all and cannot: an instance moved to a **different host** is not sent
 * the cookie in the first place, so its sign-in screen sees a first-time visitor. That is stated in
 * `docs/user-guide/authentication.md` rather than papered over.
 */
export function sessionEndReason(
  stored: { readonly expiresAt: Date } | null,
  now: Date
): SessionEndReason {
  if (!stored) return "sessions-cleared";
  if (stored.expiresAt.getTime() <= now.getTime()) return "expired";
  return "settings-changed";
}

/**
 * The one sentence the sign-in screen shows.
 *
 * **Landing on a blank form is half of what made the defect what it was**: with nothing said, the
 * collector cannot tell a fault from a consequence of something they changed on purpose. Each
 * sentence names the change that caused it and says that signing in again is the whole of the
 * remedy, which is what turns an alarming sign-out into an expected one.
 */
export function sessionEndSentence(reason: SessionEndReason): string {
  switch (reason) {
    case "settings-changed":
      return "You were signed out because this instance's authentication settings changed — its secret, or the address it is served on — and that ends every session; signing in again is all that is needed.";
    case "sessions-cleared":
      return "You were signed out because this instance no longer holds your session — replacing or resetting its database does that — and signing in again is all that is needed.";
    case "expired":
      return "You were signed out because your session had expired; signing in again is all that is needed.";
  }
}
