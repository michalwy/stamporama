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

**Pluggable platform modules.** A `PlatformModule` (`matches(url)` + `extract(document)`) registers
into a registry the content script consults. The shell ships none; Colnect is the first module (#249).
This keeps DOM specifics out of the neutral core and lets Delcampe/Allegro/… follow.

**Bearer token auth (`AssistantToken`).** A per-collection token authenticates the extension. It is
stored only as a SHA-256 hash, authorizes as the collection's owner for that one collection, and is
accepted by the matcher endpoints alongside a session via `resolveCollectionOwner` (session wins;
otherwise a valid `Authorization: Bearer` token pinned to the route's collection). A minimal generator
lives in **Settings → Colnect**; the full registration/code-exchange issuance UX is #252.

## Consequences

- The app and the extension are built and type-checked independently; `pnpm lint`/`typecheck` stay
  app-scoped, and the extension has `extension/pnpm build|typecheck`.
- The matcher endpoints are reachable both by a signed-in user (session) and the extension (token)
  with no CORS surface, because the extension calls them from its background worker.
- Tokens are owner-delegating and irrecoverable (hash-only) — a lost token is revoked and regenerated.
- The shell is intentionally partial: a single-profile stub (multi-profile + selector is #251), no
  real extractor (Colnect DOM is #249), no packaging/distribution (#254). A "Load sample refs" path in
  the popup makes the dry-run → confirm → write flow testable before #249 exists.
