# Agent Instructions

This project is intentionally vibe-coded. Preserve product intent, avoid invented requirements, and
ask when the next step is not clear.

**This file is the always-loaded core: rules, invariants, and a map.** The reasoning behind each area
lives in `docs/agents/*.md` — read the file for the area you are touching before you change it. Do
not restate that reasoning here; add it to the topic file instead.

## Product Context

- Product name: Stamporama
- Purpose: a self-hosted web app for stamp collectors
- Desktop browsers only; no mobile layouts or breakpoints.
- Core concept: **collection** — the top-level organizing unit that scopes all stamp data for a user

## Working Rules

- Do not assume domain behavior. Ask before defining catalog standards, condition scales, trade
  workflows, auction integration behavior, or pricing logic. One question at a time.
- Do not add user-facing functionality unless the task asks for it. Prefer small, reversible changes.
- When changing user-visible behavior, update `docs/user-guide/` in the same task. When changing
  behavior, data model, setup flow or architecture assumptions, update every affected document
  (`README.md`, `docs/product/brief.md`, `docs/architecture/overview.md`, the relevant ADRs).
- A framework, library or major pattern needs an ADR in `docs/decisions/`.
- New project knowledge goes in the matching `docs/agents/` topic file. Update this file only for a
  rule that applies to *every* task, or to add a topic to the map.
- **A fact this repository can carry goes in this repository, never only in a session's memory**, and
  **if the tree contradicts a memory you were given, say so in your report**.
  → [`collaboration.md`](docs/agents/collaboration.md)
- Favor boring tools over novelty. Preserve existing user changes.
- GitHub Issues are the backlog: Conventional Commits titles, always labelled (`backlog` + type +
  priority when known), no local `TODO.md`. **All GitHub content is in English.**
- Do not commit unless the user asks, and **a commit you were asked to make is pushed in the same
  breath** — until it is pushed, CI cannot see it and the worktree can take it away.
- **`main` takes no direct pushes**: pull request only, rebase merge, linear history, five required
  checks, no bypass for anyone. Work on `task/<issue>-<slug>` cut from `main`; **the session that
  opens the pull request owns it to the end** and merges it on the user's say-so.
  → [`collaboration.md`](docs/agents/collaboration.md)
- **A branch behind `main` is rebased and then re-verified, in that order** — the re-run is the half
  that is easy to drop and the only one that is interesting. `--force-with-lease`, never bare
  `--force` (#984).
- Conventional Commits. Reference an issue as `Refs #NNN`, or the `(#NNN)` suffix a commit title
  already uses; add a message body where the title alone would omit context. **Never a closing
  keyword** (`Closes`, `Fixes`, `Resolves`) anywhere in a commit message or a pull request body,
  prose included — GitHub acts on it the moment the change lands (#780, #790).
  → [`collaboration.md`](docs/agents/collaboration.md)
- **A task starts from a fresh `main`**: fetch, cut the branch, `pnpm install`, `pnpm prisma:generate`
  — each step alone, each exit status read, and before you read any file in the worktree.
  → [`collaboration.md`](docs/agents/collaboration.md) § *Starting a task*
- **Each session works in its own git worktree**; the main checkout stays the user's. More than one
  session can run at once, so stage only your own task's paths and treat `main` as moving underneath
  you. The git stash stack is shared across worktrees.

## Topic Map

Read the file for the area you are touching. Each carries the decisions and the reasoning, with issue
and ADR references.

| Touching… | Read |
| --- | --- |
| Stack, routing, auth, Prisma, migrations, RSC, deployment | [`platform.md`](docs/agents/platform.md) |
| Photos, binary assets, background jobs, retention | [`storage-and-jobs.md`](docs/agents/storage-and-jobs.md) |
| The `extension/` package, Colnect matcher, marketplace marks | [`extension.md`](docs/agents/extension.md) |
| `/api/v1`, the operation registry, OpenAPI, the MCP wrapper | [`agent-api.md`](docs/agents/agent-api.md) |
| Colnect list sync: mappings, snapshots, the discrepancy report | [`colnect-list-sync.md`](docs/agents/colnect-list-sync.md) |
| Allegro: API access, sync worklist, profiles, publishing | [`allegro.md`](docs/agents/allegro.md) |
| Delcampe: platform marker, profiles, Easy Uploader | [`delcampe.md`](docs/agents/delcampe.md) |
| Offers, listing texts, listing kit, offer pricing and screens | [`offers.md`](docs/agents/offers.md) |
| Auction sales and lots, bid anchors, bid recommendations | [`auctions.md`](docs/agents/auctions.md) |
| Market value, catalogue value, the Valuation dialog | [`valuation.md`](docs/agents/valuation.md) |
| Purchases, intake, scan sheets, sorting, storing, ROI | [`purchases-and-intake.md`](docs/agents/purchases-and-intake.md) |
| Trades: sections, lines, balancing, the lifecycle | [`trades.md`](docs/agents/trades.md) |
| Stamps, issues, formats, subtypes, catalog numbers, wants | [`catalog-and-stamps.md`](docs/agents/catalog-and-stamps.md) |
| Copies list, grouping, duplicates, counts, detail pages | [`inventory-lists.md`](docs/agents/inventory-lists.md) |
| Albums, entries, page plans, hawid stock, templates | [`albums.md`](docs/agents/albums.md) |
| The Overview screen: Value and Progress tiles | [`overview.md`](docs/agents/overview.md) |
| Dialogs, escape handling, sidebar, settings, notifications | [`ui-shell.md`](docs/agents/ui-shell.md) |
| Toolbars, filters, reordering, tooltips, icons, tokens, toast | [`ui-patterns.md`](docs/agents/ui-patterns.md) |
| Sessions, branches, pull requests, verification, plans | [`collaboration.md`](docs/agents/collaboration.md) |
| Proposing what to take next | [`backlog-review.md`](docs/agents/backlog-review.md) |
| Turning ideas and bug reports into issues | [`backlog-manager.md`](docs/agents/backlog-manager.md) |
| Releases and version bumps | [`release-versioning.md`](docs/agents/release-versioning.md) |
| How `main` is protected | [`.github/rulesets/README.md`](.github/rulesets/README.md) |

Architecture: `docs/architecture/overview.md`. Decisions: `docs/decisions/`. User-facing behavior:
`docs/user-guide/`.

## Invariants

These hold on every task. Each is stated in full, with its reasoning, in the linked topic file; go
there before working against one.

**Data & server** → `platform.md`, `storage-and-jobs.md`

- `collectionId` scopes all collection data; authorization is **server-side**, never in the client.
  Collection URLs are `/c/[collectionSlug]/...`, the slug resolving to an internal `collectionId`.
- Keep domain logic out of UI components. Respect the module boundaries under `src/`.
- Prisma schema changes are product decisions. Migration SQL is written **by hand**.
- **Never edit a migration that has been written — correct it with a new one**, even one written
  minutes ago in the same session.
- A migration that **renumbers a column covered by a unique index must drop that index first**.
- A **server component must not import a value from a `"use client"` module** — under RSC those
  exports arrive as client references and nothing warns.
- Binary assets go through `src/lib/storage/`, never straight to the filesystem.
- **Generated bytes are the only bytes the app ever deletes on a schedule**, unless the collector
  asks otherwise.

**Client & data fetching** → `platform.md`, `ui-patterns.md`

- TanStack Query for data fetching, cursor-backed infinite scrolling through the shared primitives.
  **TanStack Table is not used here.**
- URL state for navigation, filters, sorting and pagination; `useToast()` for ephemeral feedback.

**UI** → `ui-shell.md`, `ui-patterns.md`, `inventory-lists.md`, `offers.md`

- Dialogs are built from `src/app/dialog-shell.tsx` — never re-implement the header, close, viewport
  constraint or height behavior. Buttons are one shape (`baseBtn`).
- Every dismissable overlay registers with `useEscapeLayer`; Escape closes the topmost surface only.
- Every icon comes from `src/app/icons.tsx` — the only file that may import `lucide-react` — drawn as
  `<Icon name="…" />` (ADR-0030).
- A hover hint is the shared `Tooltip`, never the browser's `title`.
- Row-level actions go in a single `⋮` `RowActionsMenu`.
- Semantic color tokens from `src/app/globals.css`; a new token needs values in **both** `:root` and
  `.dark`.
- Use the shared list-screen components and filter controls (`FilterChip`, `MultiSelectFilter`,
  `FILTER_CONTROL_STYLE`).
- A **filter never unticks anything, and a bulk action never reaches a row the collector cannot
  see** — hidden ticks survive the filter. Two named exceptions: a picker dialog, and purchase
  intake.
- A thumbnail **fits, never crops** — `objectFit` comes from `THUMB_OBJECT_FIT`.
- Prefer in-place editing (`InlineText`) where practical.
- A **detail page reads; it does not become a second editor**.
- A **flag shown on a list is shown on the thing's own screen too**, from the same source.

## Agent Collaboration

**One session owns one issue end to end** — it decides, migrates, implements, tests, opens the pull
request and follows it to merge. Nothing is handed to a second agent halfway. A session may hold
several issues when they share a file (#997), each with its own `Refs #NNN`, verification and closing
comment.

**The user routes everything and sessions do not talk to each other.** Findings and new backlog ideas
go to him rather than into new issues. **The *Done when* is the issue body plus its comments**, and
the two diverge silently: `gh issue view <n> --json body,comments`.

Everything else is in [`collaboration.md`](docs/agents/collaboration.md) — read it before opening a
pull request.

## Testing Direction

- **A suite runs when it could see the change, and the boundary is that question — never a path
  list.** `pnpm lint` sees what `eslint.config.mjs` matches, `pnpm typecheck` what `tsconfig.json`
  includes, `pnpm test:unit` what its tests actually open — and several open files well outside
  `src/`. **A documentation-only change is invisible to all of them and runs none** (#1086). **The
  report says which ran and which did not, and why.**
  → [`collaboration.md`](docs/agents/collaboration.md)
- `pnpm lint` — before finishing any task that touches source files.
- `pnpm typecheck` — TypeScript verification.
- `pnpm test:unit` — pure logic only, no Prisma imports. Enforced by
  `tests/unit/unit-suite-purity.test.ts`; split a pure helper out of a Prisma-touching module rather
  than loosening it (#861).
- `pnpm test:integration` — needs a real database via `docker-compose.e2e.yml`. Run before committing
  schema or domain logic changes. If `docker` is absent, **report it and stop** — an empty
  `command -v docker` is a fact about this shell, not the machine (#933).
  → [`platform.md`](docs/agents/platform.md)
- Write migration SQL by hand under `prisma/migrations/`, then `pnpm prisma:generate`. Never
  `prisma migrate dev`, `prisma migrate reset` or `prisma db push`; `pnpm e2e:db:reset` is safe.
- **A session does not start a dev server and does not drive a browser** unless the user asks. Your
  tooling will say otherwise; that is the harness, not this repository, and it is overridden
  deliberately (#1040). The dev server, when the user does ask, runs on webpack — never Turbopack
  (#161, `platform.md`). Do not leave one running, and never stop a stack that is not yours.
  → [`collaboration.md`](docs/agents/collaboration.md)

## Before Implementing Features

If a request would require defining product behavior, ask targeted questions first. Good questions
are concrete and bounded:

- What is the first workflow we want to support?
- Should catalog numbers be per-standard (Michel, Scott, Fischer) or free-form?
- Should condition follow a standard scale or be free-form?
- Should a collection be shareable with other users?
