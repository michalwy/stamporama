# Agent Instructions

This project is intentionally vibe-coded. Future agents must preserve product intent, avoid invented requirements, and ask clarifying questions when the next step is not clear.

**This file is the always-loaded core: rules, invariants, and a map.** The reasoning behind each area of the product lives in `docs/agents/*.md` — read the file for the area you are touching before you change it. Do not restate that reasoning here; add it to the topic file instead.

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
- When new project knowledge or a workflow rule would help future agents, write it into the matching `docs/agents/` topic file. Update this file only for a rule that applies to *every* task, or to add a new topic to the map.
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

## Topic Map

Read the file for the area you are touching. Each one carries the decisions and the reasoning behind them, with issue and ADR references.

| Touching… | Read |
| --- | --- |
| Stack, routing, auth, Prisma/Postgres, migrations, RSC boundaries, deployment | [`docs/agents/platform.md`](docs/agents/platform.md) |
| Photos and binary assets, background jobs, upload caps, retention and deletion | [`docs/agents/storage-and-jobs.md`](docs/agents/storage-and-jobs.md) |
| The `extension/` package, Colnect matcher, marks drawn on marketplace pages | [`docs/agents/extension.md`](docs/agents/extension.md) |
| Allegro API access, sync worklist, listing profiles, categories, publishing | [`docs/agents/allegro.md`](docs/agents/allegro.md) |
| Delcampe platform marker, listing profiles, Easy Uploader defaults | [`docs/agents/delcampe.md`](docs/agents/delcampe.md) |
| Offers, listing texts, listing kit, offer pricing, offer screens | [`docs/agents/offers.md`](docs/agents/offers.md) |
| Auction sales and lots, bid anchors, bid recommendations, auction screens | [`docs/agents/auctions.md`](docs/agents/auctions.md) |
| Market value, catalogue value, the Valuation dialog | [`docs/agents/valuation.md`](docs/agents/valuation.md) |
| Purchases, intake, scan-sheet ingest, delivery/disposal, sorting, storing, ROI | [`docs/agents/purchases-and-intake.md`](docs/agents/purchases-and-intake.md) |
| Stamps, issues, formats, subtypes, catalog numbers, checklists, wants | [`docs/agents/catalog-and-stamps.md`](docs/agents/catalog-and-stamps.md) |
| Copies list, grouping, duplicates, copy counts, detail pages | [`docs/agents/inventory-lists.md`](docs/agents/inventory-lists.md) |
| Dialogs, escape handling, sidebar, settings placement, notifications | [`docs/agents/ui-shell.md`](docs/agents/ui-shell.md) |
| Toolbars, filters, expansion, reordering, tooltips, icons, tokens, toast | [`docs/agents/ui-patterns.md`](docs/agents/ui-patterns.md) |
| Backlog review workflow | [`docs/agents/backlog-review.md`](docs/agents/backlog-review.md) |
| Releases and version bumps | [`docs/agents/release-versioning.md`](docs/agents/release-versioning.md) |

Architecture overview: `docs/architecture/overview.md`. Decisions: `docs/decisions/` (ADR-0001…). User-facing behavior: `docs/user-guide/`.

## Invariants

These hold on every task, whatever you are building. Each is stated in full — with its reasoning — in the linked topic file; go there before working against one.

**Data & server**

- `collectionId` scopes all collection data; authorization is checked **server-side**, never in the client. Collection URLs are `/c/[collectionSlug]/...` and the slug resolves to an internal `collectionId`. → `platform.md`
- Keep domain logic out of UI components. Respect the explicit module boundaries under `src/`. → `platform.md`
- Treat Prisma schema changes as product decisions. Write migration SQL **by hand**; never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`. → `platform.md`
- A migration that **renumbers a column covered by a unique index must drop that index first**. → `platform.md`
- A **server component must not import a value from a `"use client"` module** — under RSC those exports arrive as client references, and nothing warns. → `platform.md`
- Binary assets go through the `src/lib/storage/` interface, never straight to the filesystem. → `storage-and-jobs.md`
- **Generated bytes are the only bytes the app ever deletes on a schedule** — unless the collector explicitly asks otherwise. → `storage-and-jobs.md`

**Client & data fetching**

- TanStack Query for data fetching, TanStack Table for list views; cursor-backed infinite scrolling through the shared primitives. → `platform.md`
- URL state for navigation, filters, sorting and pagination; toast (`useToast()`) for ephemeral feedback. → `ui-patterns.md`

**UI**

- Build dialogs from the shared `src/app/dialog-shell.tsx` primitives — never re-implement the header, close, viewport constraint or height behavior. Buttons are one shape (`baseBtn`). → `ui-shell.md`
- Every dismissable overlay registers with `useEscapeLayer`; Escape closes exactly one surface, the topmost. → `ui-shell.md`
- Every icon comes from `src/app/icons.tsx` — the only file that may import `lucide-react` — drawn as `<Icon name="…" />` (ADR-0030). → `ui-patterns.md`
- A hover hint is the shared `Tooltip`, never the browser's `title` attribute. → `ui-patterns.md`
- Row-level actions go in a single `⋮` `RowActionsMenu`, not a cluster of per-row buttons. → `ui-patterns.md`
- Use semantic color tokens from `src/app/globals.css`; a new token needs values in **both** `:root` and `.dark`. → `ui-patterns.md`
- Use the shared list-screen components (loading, empty, filters, table, endless scroll) and the shared filter controls (`FilterChip`, `MultiSelectFilter`, `FILTER_CONTROL_STYLE`). → `ui-patterns.md`
- A thumbnail **fits, never crops** — `objectFit` comes from `THUMB_OBJECT_FIT`. → `ui-patterns.md`
- Prefer in-place editing (`InlineText`) where inline edits are practical. → `ui-patterns.md`
- A **detail page reads; it does not become a second editor**. → `inventory-lists.md`
- A **flag shown on a list is shown on the thing's own screen too**, from the same source. → `offers.md`

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
