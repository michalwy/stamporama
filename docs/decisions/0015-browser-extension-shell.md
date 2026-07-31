# ADR-0015: Stamporama Assistant Browser Extension Shell

## Status

Accepted

## Context

Colnect has no public API or import (#155). The chosen mechanism for matching Colnect catalog pages
against a collection is a **browser extension** the collector runs while browsing Colnect (#249–#254).
This is the first non-Next.js build artifact in the repo, and it must reach a Stamporama instance that
is not the page's origin (a dev server, or a self-hosted box on the LAN) from `colnect.com`.

Two problems shape the design:

1. **Cross-site auth.** The extension calls our Colnect matcher endpoints (#250) from `colnect.com`.
   That is a cross-site request, so Better Auth's `Lax` session cookie is not sent. Session auth alone
   cannot work from the extension.
2. **Tooling.** An MV3 extension is a separate bundle (background service worker, content script,
   popup, options) with its own globals (`chrome.*`) and lifecycle — it does not belong inside the
   Next.js app's build or type-checking.

## Decision

**Isolated workspace package.** The extension lives in `extension/`, a second pnpm-workspace package
with its own `package.json`, `tsconfig.json` (`types: ["chrome"]`), and build. The root `tsconfig`
and ESLint config exclude `extension/`; it is type-checked and built on its own. Bundling is plain
**esbuild** + a hand-written `manifest.json` (each entrypoint → a self-contained IIFE, static assets
copied to `dist/`) — deliberately boring and explicit over an extension framework (AGENTS.md).

**Background-service-worker I/O.** All instance HTTP calls go through the background service worker,
whose `fetch` under `host_permissions` is exempt from CORS — so no server-side CORS changes are
needed. The popup drives the flow and messages the SW; the content script only extracts.

**Pluggable platform modules.** A `PlatformModule` registers into a registry the content script
consults. The shell ships none; Colnect is the first module (#249). This keeps DOM specifics out of
the neutral core and lets Delcampe/Allegro/… follow.

**Two halves per module, the second optional (#408).** Reading a page and posting a listing are the
symmetric halves of the same job, so listing is part of the same interface rather than a Colnect
extra: an optional `listing` (`formUrl` / `isFormUrl` / `fill`) beside the extraction pair. Optional,
because a module that only reads a marketplace is a complete module — the platform it serves simply
offers no **List via Assistant** (#407) — and the registry reports which modules carry which half so
no surface has to hard-code ids. The task a module fills from is the **listing kit** (#405)
unchanged: it states what the listing holds, never how a form is laid out, and the mapping onto
fields is the module's own. Driving it is two pure steps around the navigation that separates them
(`resolveListingTarget` → `fillListing`), with the tab-opening and the report back to the instance
left to the wiring (#407/#409) — the part a second marketplace reuses without change.

**A third half, and every half optional (#355).** Capturing one **auction listing** for the
[watchlist](0021-auction-tracking-model.md) is neither of the two above: it reads a page, but it
reads *one lot* rather than the stamps on a catalogue page, and it produces a watchlist entry rather
than a match. It is therefore a third optional member — `capture` (`isListingUrl` / `capture`) — and
the extraction pair moved into an optional `extraction` member beside it, because Allegro carries
capture **alone**: it is a marketplace this collection bids on, not a catalogue to match against or a
shop to list into, and a module carrying one half is a complete module exactly as a read-only one is.
`moduleReports()` names all three, so no surface hard-codes ids. The captured shape is neutral (offer
id, URL, title, seller, closing instant, opening price, current bid); where it lands — which platform,
which seller, which parcel — is decided **server-side** (`captureAuctionLot`), since every part of
that answer is a `Contact` of a collection the marketplace knows nothing about. Which platform *is*
Allegro is one setting on its own Settings tab (`Contact.platformModule`, the same marker #406 uses),
because it is the one fact a listing page cannot state.

**Bearer token auth (`AssistantToken`).** A per-collection token authenticates the extension. It is
stored only as a SHA-256 hash, authorizes as the collection's owner for that one collection, and is
accepted by the matcher endpoints alongside a session via `resolveCollectionOwner` (session wins;
otherwise a valid `Authorization: Bearer` token pinned to the route's collection).

**The instance registers itself (#252).** Rather than have the collector type an instance URL, a
collection id, and a token into the extension, **Settings → Assistant** mints a short-lived
single-use code (`AssistantRegistrationCode`, hash-stored like a token) and exposes it on the page
with the instance's own origin and current collection; clicking the toolbar icon reads that payload
under `activeTab` and exchanges the code at `POST /api/assistant/register` for a token. Alternatives
rejected: a redirect or custom-scheme handoff (puts a token in a URL, and needs a registered scheme),
and a pre-declared instance origin (there isn't one — every self-hosted instance is a different
host). Manual token generation stays for callers that cannot register.

## Consequences

- The app and the extension are built and type-checked independently; `pnpm lint`/`typecheck` stay
  app-scoped, and the extension has `extension/pnpm build|typecheck`.
- The matcher endpoints are reachable both by a signed-in user (session) and the extension (token)
  with no CORS surface, because the extension calls them from its background worker.
- Tokens are owner-delegating and irrecoverable (hash-only) — a lost token is revoked and regenerated.
- The action opens the UI as a **centred `chrome.windows` popup window**, not a toolbar popup: a
  toolbar popup cannot exceed 800×600 and is anchored to the icon, which is too cramped for
  comparing an item against candidate stamps. The consequence is that the UI is its own window, so
  the source tab's id is passed in the URL — inside that window "the active tab of the current
  window" is the Assistant itself, not the page being matched.
- Supported pages are **matched as they load** (#283) so the badge counts stamps needing action
  rather than stamps present, with the result cached per tab for an instant window. That makes the
  extension talk to the instance on every supported page view — read-only, but a posture change, so
  it is switchable in Options (default on) and fails silently to the detected count when the
  instance is unreachable.
- The content script runs **declaratively** on `colnect.com` (a coarse manifest match; the module's
  own `matches(url)` does the precise check) so the toolbar badge can show how many items a page
  holds before the popup is opened. That detection is entirely local — no instance call is made for
  it — and the popup still injects on demand as well, covering tabs opened before an extension
  reload. Per the #249 ToS note this only ever touches pages the user themselves opened.
- The extension holds **several connection profiles** (#251), each one instance + one collection +
  its token, with the active one persisted and switchable from both Options and the Assistant
  window's header. The target is an explicit choice, never inferred, because dev and production are
  driven from the same browser on the same `colnect.com` origin; the active one is named in an
  always-visible badge and again in every write confirm, and wears a colour derived from its target
  (hashed, de-collided) so the instance is recognisable rather than merely readable. Switching drops
  the on-screen results and the background's per-tab match cache — they describe the instance being
  left.
- Registration is driven by the **toolbar-icon click**, which is what grants `activeTab` and so
  permits reading a page on an instance origin the extension never declared. The exchange itself runs
  in the background worker, CORS-exempt under `host_permissions`. The consequence is a two-click
  setup with no typing, whose `apiBaseUrl` is correct by construction (the instance served it) — and
  that dev and production are told apart by *where you registered from*, not by what someone typed.
- The one-time code is the only credential ever on a page, for minutes and for one use; the token is
  minted server-side and is revocable per registration. Re-registering an instance+collection the
  extension already holds **refreshes that profile's token in place**, which is the recovery path for
  a revoked or lost token.
- The extension answers the page by setting `data-registration-*` attributes on the payload element
  (attributes, because its world is isolated and React owns the node), so the outcome is visible
  where the user is looking rather than inside the extension.
- Listing is **filling, never posting**: a module stops before submit, so nothing reaches a
  marketplace without the collector clicking the platform's own button. The fill is guarded by the
  module's `isFormUrl`, and its outcome is a report of what was filled *and* what was skipped —
  a field the task cannot answer (an unmapped condition above all) is a skip, not an error, and the
  rest of the form is still filled.
- The shell remains partial where the work is scheduled elsewhere: there is no
  packaging/distribution (#254).
