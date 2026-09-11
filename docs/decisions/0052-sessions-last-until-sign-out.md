# ADR-0052: A Session Lasts Until the Collector Signs Out, and the Cookie Is Re-Leased on Every Request

## Status

Accepted and implemented in #1175. The collector reported the defect on 2026-09-11 and the rule was
settled with him the same day. #1176 — not losing your place when a session *does* end — is the
sibling and is untouched by this.

## Context

The collector was returned to the sign-in screen in the middle of working. Not often, but
repeatedly, on the self-hosted instance and on a local dev server alike; nothing they did asked for
it, and whatever was open at that moment was lost.

This is an instance one person runs for their own collection. Being asked to prove who they are,
unprompted and at no particular moment, buys nothing and costs them their place. The rule the
collector settled on is therefore the plain one: **while nothing about the instance changes, a
session lasts until they sign out.** No inactivity window, no fixed lifetime. Restarting the app —
the container, or a dev server — is ordinary use, not a change.

What is explicitly *not* the defect: a change to the instance's configuration or infrastructure
ending every session. Rotating `BETTER_AUTH_SECRET`, moving the instance to another address or
replacing its database invalidates what a session is built on, and ending sessions there is the
honest outcome.

### What was actually happening

Better Auth writes its session cookie exactly **once**, at sign-in, with
`Max-Age = session.expiresIn` — seven days by default. It does re-issue the cookie from
`getSession`, and it does slide the stored row's `expiresAt`, but the re-issue only ever lands on a
**response it controls**: `auth.api.getSession({ headers })` returns the session and discards the
`Set-Cookie` it produced.

Every session read in this app goes through that call, from a server component or a server action.
There is no `authClient.useSession()` anywhere, no `nextCookies()` plugin, and no client-side
session poll. So the stored row slid and the cookie in the browser never did: **seven days after
signing in, mid-task, the browser simply stopped sending it.** "Not often, but repeatedly" is
weekly, and it matches both deployments because it is a property of the code rather than of either
one.

## Decision

**Two halves, and the rule needs both.**

### 1. The spans are long enough that they are never what ends a session

`src/lib/session-lifetime.ts` holds them and `src/lib/auth.ts` takes them: `expiresIn` ten years,
`updateAge` thirty days.

Ten years is **not a policy**. A cookie that is to survive closing the browser must state *some*
expiry, and `session.expiresAt` is a non-nullable column, so "never" has to be spelled as a date; ten
years is far enough out that nothing in ordinary use reaches it. `updateAge` is a write frequency
and nothing else — it decides how often Better Auth slides the stored row, and thirty days is chosen
over the default day because that refresh is a database write performed while a server component
renders and, against a ten-year lifetime, there is nothing urgent about it.

### 2. The cookie's lease is renewed on every request the collector makes

`src/proxy.ts` — Next's middleware convention, which in Next 16 is spelled `proxy.ts` — re-issues
whichever of the two session cookie names the request carried, verbatim, with a fresh `Max-Age`.

**This is the half that is easy to leave out, and leaving it out would have shipped the same defect
at a longer period.** Browsers cap a cookie's own lifetime at **400 days** regardless of what the
server asks for. Without a renewal, "ten years" silently becomes thirteen months and the collector
is signed out mid-task again — rarer, and much harder to recognise for what it is. With it, the span
that applies is ten years from the collector's **last visit** rather than from their sign-in, and
the browser cap never binds.

Three properties make this cheap and safe:

- **It authorizes nothing.** The value is opaque to it. Extending how long a browser keeps a
  credential is a different decision from accepting one, and every request carrying the cookie still
  has it checked server-side by Better Auth. That is what lets it run on the Edge runtime with no
  secret, no database and no Prisma — a proxy that *authorized* would need all three, which is
  precisely why this project has never had one.
- **The bytes survive the round trip.** Next decodes a request cookie and re-encodes a response
  cookie with the same rules, so a base64 signature's `+`, `/` and `=` come back out as they went
  in. That equivalence is pinned by a unit test, because if the two halves ever stop agreeing the
  renewed cookie is a *different* credential and every collector is signed out at once.
- **`/api/auth` is excluded, and that exclusion is what keeps signing out immediate.**
  `/api/auth/sign-out` answers with a cookie-clearing `Set-Cookie`; a renewal added to the same
  response would be a second `Set-Cookie` for the same name whose ordering nothing guarantees.
  Better Auth's own routes mint and clear this cookie themselves and never want a renewal from here.

### 3. A session that ends without being asked to says why

`src/lib/session-end.ts` (the lookup) over `src/lib/session-lifetime.ts` (the pure rules).

Landing on a blank form is half of what made the defect what it was: the collector cannot tell a
fault from a consequence of something they changed on purpose. The condition is narrow and exact —
**this browser holds a session this instance will not take**. Signing out clears the cookie, so a
cookie still present while the sign-in form is on screen means something *else* ended the session.

The signed cookie is `` `${token}.${signature}` `` and the token is in the clear, which is what makes
three reasons tellable apart with one lookup:

| What the token resolves to | What it means | 
| --- | --- |
| No row | This instance no longer holds the session — replacing or resetting the database is what usually does that |
| A row past its date | The session expired — only reachable for one minted before this change |
| A live row | The cookie's signature or its `__Secure-` prefix no longer matches: the secret was rotated, or the instance moved between `http` and `https` |

Each gets one sentence naming the change and saying that signing in again is the whole of the
remedy. Nothing is cleared afterwards and nothing needs to be: the explanation stays true for as
long as the refused cookie is there, and signing in overwrites it.

**The missing-row sentence names a likely cause rather than a finding, and that is deliberate.**
Re-leasing on every request means a request already in flight when the collector signs out can put
the cookie back a moment after `/api/auth/sign-out` deleted its row — a window of milliseconds, with
nothing reachable and nothing at risk, but the browser then holds a receipt for a session that is
gone. Asserting *the database was replaced* would be wrong in that case; stating what is true and
offering the usual cause is right in both. Closing the race outright would take a proxy that could
tell a live session from a dead one, which is the authorization this file exists not to do.

**One case has no sentence and cannot have one.** An instance moved to a different *host* is never
sent the cookie, so its sign-in screen sees a first-time visitor. That is written down in
`docs/user-guide/authentication.md` rather than papered over.

## Consequences

- A collector stays signed in across restarts, across weeks away, and across browser restarts. The
  only thing they can do to end a session is sign out, and it stays immediate.
- **This project now has a proxy/middleware file, and it did not before.** It is deliberately the
  smallest one that could exist — no routing, no redirects, no authorization — and the temptation it
  invites is to start protecting routes from it. Route protection lives in each layout, page and
  server action's own `getSession`, where it has access to the database and to the collection; the
  architecture overview previously *described* a protecting middleware that has never existed, and
  that paragraph is corrected rather than implemented.
- The two session cookie names are now written down in this repository. They are derived from Better
  Auth's `cookiePrefix` and its `__Secure-` rule; a Better Auth major that changes either would
  break the renewal silently — the session would go back to a seven-day-shaped lease with nothing
  red to show for it. `better-auth` is on `renovate.json`'s **never-alone** list for this reason.
- A sign-in page render now costs a cookie read and, only when a refused cookie is present, one
  indexed `session` lookup.
