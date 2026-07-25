# Agent Instructions

This project is intentionally vibe-coded. Future agents must preserve product intent, avoid invented requirements, and ask clarifying questions when the next step is not clear.

## Product Context

- Product name: Stamporama
- Purpose: a self-hosted web app for stamp collectors
- Desktop browsers only; no mobile layouts or breakpoints.
- Core concept: **collection** — the top-level organizing unit that scopes all stamp data for a user

## Working Rules

- Do not assume domain behavior. Ask before defining catalog standards, condition scales, trade workflows, auction integration behavior, or pricing logic. Ask one question at a time.
- Do not add user-facing functionality unless the current task explicitly asks for it.
- Prefer small, reversible changes with clear documentation.
- When changing user-visible behavior, update `docs/user-guide/` in the same task.
- When changing behavior, data model, setup flow, or architecture assumptions, update every affected document (`README.md`, `docs/product/brief.md`, `docs/architecture/overview.md`, relevant ADRs, `docs/user-guide/`).
- When introducing a framework, library, or major pattern, add or update an ADR in `docs/decisions/`.
- Update this `AGENTS.md` file when new project knowledge or workflow rules would help future agents.
- Favor boring, well-supported tools over novelty. Preserve existing user changes.
- Use GitHub Issues as the shared backlog. Use Conventional Commits for issue titles. Always assign labels (`backlog` + type + priority when known). Do not maintain a local `TODO.md`.
- If GitHub connector cannot create issues, use `gh` CLI as fallback.
- All GitHub content must be in English.
- Do not create git commits unless the user explicitly asks. Do not push unless explicitly asked.
- Solo project: commit directly to `main` by default. Create feature branches only when the user asks for a PR.
- When pushing to `main`, try `git push origin main` first. If rejected, fetch, rebase, rerun verification, push again.
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, etc. Include GitHub issue reference when one exists.
- When a commit title alone would omit useful context, include an extended commit message body.
- Use a separate git worktree only when the user explicitly asks for one.

## Backlog Review & Release Versioning

See `docs/agents/backlog-review.md` and `docs/agents/release-versioning.md` for detailed instructions on these workflows.

## Multi-Step Implementation Plans

When a task spans more than one logical area, write an implementation plan before starting. Store it under `.claude/plans/`. A plan is executed fully within a single session.

- Begin with a `## Progress` section containing a checkbox list of numbered steps.
- Steps are executed in order. Mark each step `[x]` immediately after completing it.
- Each step must state a **Done when** criterion.

## Agent Collaboration

Use specialized roles only when the task benefits from them. Small, localized tasks can be handled by one agent.

Use specialized roles for larger changes that cross domain, data, authorization, or user-flow boundaries:

- Architect: schema, ADRs, major patterns.
- Designer: UI flows, dialogs, interaction design.
- Developer: scoped implementation.
- Tester/Reviewer: browser flows, regressions.

Prefer Architect before changing Prisma schema, permissions, collection scoping, authentication, routing, or ADR-documented patterns. Prefer Tester/Reviewer after changing forms, dialogs, collection routing, authentication, permissions, or migrations.

## Technical Direction

- Collection-scoped access control: `collectionId` on data, owner has full access, checks live server-side.
- Collection URLs: `/c/[collectionSlug]/...`; slug resolution authorizes by internal `collectionId`.
- Better Auth for authentication.
- Prisma with PostgreSQL (minimum **version 15** — migrations use `NULLS NOT DISTINCT`; see ADR-0006). Treat schema changes as product decisions.
- SPA-like collection interaction: Next.js App Router as route/auth shell, client-side queries/mutations for rich screens.
- TanStack Query for data fetching, TanStack Table for list views.
- Cursor-backed infinite scrolling for large lists via shared primitives.
- Keep domain logic out of UI components. Keep authorization server-side.
- Explicit module boundaries under `src/`.
- Self-hosted deployment: CI pushes multi-arch image to `ghcr.io/michalwy/stamporama` for release tags only. `docker-compose.prod.yml` + `.env` for production. `scripts/install.sh` is the curl-able installer. Version baked via `STAMPORAMA_VERSION` build arg, shown through `getAppVersion()` in `src/lib/version.ts`.
- Browser extension (Stamporama Assistant, #253; ADR-0015) lives in `extension/` — a separate pnpm-workspace package (MV3, esbuild + hand-written `manifest.json`, own `tsconfig`). It is **excluded from the app's** `pnpm lint`/`typecheck`; build and check it on its own with `cd extension && pnpm build|typecheck`. It calls the Colnect matcher endpoints with an `AssistantToken` bearer (session-or-token auth via `src/lib/route-auth.ts`), because the extension reaches us cross-site from colnect.com. Tokens are obtained by **self-registration** (#252): Settings → Assistant exposes a one-time code + the instance's own origin on the page, and a toolbar-icon click exchanges it at `POST /api/assistant/register` (`src/lib/assistant-registration.ts`).
- Assistant **distribution** (#288; ADR-0017, superseding ADR-0016) — published to an **unlisted Chrome Web Store listing**; the store assigns the ID and signs, so there is no CRX, no signing key and nothing served by the instance. `extension/pack.mjs` (`pnpm assistant:zip` from the root) writes a store ZIP with the app version stamped in; CI's `publish-extension` job uploads and publishes it per release tag (`CWS_CLIENT_ID`/`CWS_CLIENT_SECRET`/`CWS_REFRESH_TOKEN` secrets, `CWS_PUBLISHER_ID`/`CWS_EXTENSION_ID` variables). Self-hosted force-install was tried and fails: Chrome honours a non-store `update_url` only on an enterprise-managed machine. The unpacked dev build and the store build stay **two extensions** with two IDs (`extension/identity.mjs`; `manifest.json` carries no `key`), so both can live in one browser and a dev profile can never reach a production collection.
- Binary assets (photos, #112) sit behind the `src/lib/storage/` interface (filesystem + GCS, #138; ADR-0011; active write backend via `STAMPORAMA_STORAGE_BACKEND`, per-photo reads) — async/streaming, `resolveUrl` returns stream-or-redirect, write-one/read-many by per-row `storageBackend`. Bytes live under `STAMPORAMA_DATA_DIR` (the `stamporama-data` volume), never in `public/`; serve them through collection-scoped route handlers. Multipart uploads use route handlers, not server actions. `Photo` is polymorphic over **three** owners — `Item`, `Stamp`, `Offer` (#311, generated listing images, `kind = generated`) — with a `num_nonnulls(...) = 1` CHECK; deleting any owner must delete the bytes explicitly (the cascade only drops rows).
- Background work runs **in-process**, started from `src/instrumentation.ts` `register()` — no extra compose service. Two shapes: *periodic* stateless sweeps (the photo orphan GC, #112) and *triggered* jobs queued in a **table** whose row is also the state the UI polls (offer photo generation, #311; ADR-0018). A queued job must be idempotent — `running` rows are requeued at boot — and enqueuing must be a no-op while a run is already queued or in flight. Pin worker state to `globalThis` so `next dev` HMR cannot stack a second interval.

## UI Direction

- Modal dialogs for list actions (add, edit). Build with shared `src/app/dialog-shell.tsx` primitives — do not duplicate dialog header, close, viewport constraint, or height behavior.
- Row-level actions go in a single `⋮` menu, not a cluster of per-row buttons. Use the shared `RowActionsMenu` (`src/app/c/[collectionSlug]/shared/row-actions-menu.tsx`); destructive actions get `danger` + `separatorBefore`. Dialog-opening actions expose `{ action, dialog }` hooks rendered at the row level (see `use-price-details-action.tsx`, `use-inventory-copy-actions.tsx`) so the dialog survives the menu closing. Section-level adds (e.g. + Add area) stay as standalone buttons.
- Config screen placement: **catalog taxonomy** that is set up once (Areas, Catalogs, Conditions) lives in **Settings** tabs; **operational data** touched routinely (Locations) gets its own **Collection** nav page. Both reuse the same adjacency-list tree pattern (`buildTree`, `*-tree-select.tsx`, `RowActionsMenu`) — mirror `areas-panel.tsx` / `locations-panel.tsx` rather than reinventing tree/list/dialog scaffolding.
- Tabs inside dialogs are visual grouping only — one logical save action. Dialog height determined by default tab; switching tabs must not change height. Body scrolls, header/footer fixed.
- Prefer in-place editing for fields where inline edits are practical.
- Shared base components for list screens (loading, empty, filters, table, endless scroll).
- Use semantic color tokens from `src/app/globals.css` for UI intent. New tokens must have values in both `:root` (light) and `.dark` blocks.
- URL state for navigation/filters/sorting/pagination; toast for ephemeral feedback.

## Testing Direction

- `pnpm lint` — run before finishing any task that touches source files.
- `pnpm typecheck` — TypeScript verification.
- `pnpm test:unit` — pure logic only, no Prisma imports.
- `pnpm test:integration` — requires real database via `docker-compose.e2e.yml`. Run before committing schema or domain logic changes.
- Write migration SQL manually. Create directory and `migration.sql` by hand under `prisma/migrations/`. Then `pnpm exec prisma generate`.
- Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` directly. Exception: `pnpm e2e:db:reset` is safe.
- When starting a local dev server for verification, use `pnpm exec next dev --webpack -p 3002` and stop it before finishing.
- Always run the dev server on **webpack** (`next dev --webpack`), never the default Turbopack: Turbopack's dev/HMR leaks memory until the container OOMs (an open, idle browser tab grows the server heap unbounded; webpack plateaus). The `docker-compose.dev.yml` overlay is pinned to `--webpack` for this reason. See issue #161; re-test Turbopack after Next.js upgrades and revert once fixed upstream.
- The user tests the app through Docker Compose. Do not leave dev servers running.

## Before Implementing Features

If a request would require defining product behavior, ask targeted questions first. Good questions are concrete and bounded:

- What is the first workflow we want to support?
- Should catalog numbers be per-standard (Michel, Scott, Fischer) or free-form?
- Should condition follow a standard scale or be free-form?
- Should a collection be shareable with other users?
