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
  workflows, auction integration behavior, or pricing logic. Ask one question at a time.
- Do not add user-facing functionality unless the current task explicitly asks for it.
- Prefer small, reversible changes with clear documentation.
- When changing user-visible behavior, update `docs/user-guide/` in the same task.
- When changing behavior, data model, setup flow, or architecture assumptions, update every affected
  document (`README.md`, `docs/product/brief.md`, `docs/architecture/overview.md`, relevant ADRs,
  `docs/user-guide/`).
- When introducing a framework, library, or major pattern, add or update an ADR in `docs/decisions/`.
- New project knowledge goes in the matching `docs/agents/` topic file. Update this file only for a
  rule that applies to *every* task, or to add a topic to the map.
- **A fact this repository can carry goes in this repository, never only in a session's memory.**
  Memory is machine-local and nothing expires it. Keep in memory only what the repository cannot hold
  — the user's own preferences, machine-local facts, pointers outside git — and make any entry that
  does describe this project a pointer rather than a copy. **If the tree contradicts a memory you
  were given, say so in your report.** → [`collaboration.md`](docs/agents/collaboration.md)
- Favor boring, well-supported tools over novelty. Preserve existing user changes.
- Use GitHub Issues as the backlog. Conventional Commits for issue titles. Always label (`backlog` +
  type + priority when known). No local `TODO.md`. **All GitHub content is in English.**
- Do not create git commits unless the user asks. **A commit you were asked to make is pushed in the
  same breath** — until it is pushed, CI cannot see it and the worktree can take it away.
- **`main` takes no direct pushes.** Protected with no bypass for anyone: pull request only, rebase
  merge, linear history, five required checks. Work on `task/<issue>-<slug>` cut from `main`; **the
  session that opens the pull request owns it to the end** and merges it on the user's say-so.
  → [`collaboration.md`](docs/agents/collaboration.md)
- **A branch behind `main` is rebased and then re-verified, in that order** — the re-run is the half
  that is easy to drop and the only half that is interesting. Force-push with `--force-with-lease`,
  never bare `--force` (#984).
- Conventional Commits: `feat:`, `fix:`, `docs:`. Reference an issue as `Refs #NNN`, or the `(#NNN)`
  suffix a commit title already uses. **Never a closing keyword** (`Closes`, `Fixes`, `Resolves`) in
  a commit message or a pull request body, prose included — GitHub acts on it the moment the change
  lands, and that is how #780 was closed before anybody had read its *Done when*. `Closing reference
  check` in CI covers both halves; `gh pr view <n> --json closingIssuesReferences` sees the body only
  (#790). When a commit title alone would omit useful context, add a message body.
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
| Stack, routing, auth, Prisma/Postgres, migrations, RSC boundaries, deployment | [`platform.md`](docs/agents/platform.md) |
| Photos and binary assets, background jobs, upload caps, retention and deletion | [`storage-and-jobs.md`](docs/agents/storage-and-jobs.md) |
| The `extension/` package, Colnect matcher, marks drawn on marketplace pages | [`extension.md`](docs/agents/extension.md) |
| `/api/v1`, the agent operation registry, the OpenAPI document, the MCP wrapper | [`agent-api.md`](docs/agents/agent-api.md) |
| Colnect list sync: list mappings, list snapshots, the discrepancy report | [`colnect-list-sync.md`](docs/agents/colnect-list-sync.md) |
| Allegro API access, sync worklist, listing profiles, categories, publishing | [`allegro.md`](docs/agents/allegro.md) |
| Delcampe platform marker, listing profiles, Easy Uploader defaults | [`delcampe.md`](docs/agents/delcampe.md) |
| Offers, listing texts, listing kit, offer pricing, offer screens | [`offers.md`](docs/agents/offers.md) |
| Auction sales and lots, bid anchors, bid recommendations, auction screens | [`auctions.md`](docs/agents/auctions.md) |
| Market value, catalogue value, the Valuation dialog | [`valuation.md`](docs/agents/valuation.md) |
| Purchases, intake, scan-sheet ingest, delivery/disposal, sorting, storing, ROI | [`purchases-and-intake.md`](docs/agents/purchases-and-intake.md) |
| Trades, trade sections and lines, balancing, the trade lifecycle | [`trades.md`](docs/agents/trades.md) |
| Stamps, issues, formats, subtypes, catalog numbers, checklists, wants | [`catalog-and-stamps.md`](docs/agents/catalog-and-stamps.md) |
| Copies list, grouping, duplicates, copy counts, detail pages | [`inventory-lists.md`](docs/agents/inventory-lists.md) |
| Albums and their entries, page plans, hawid stock and the box rule, album templates | [`albums.md`](docs/agents/albums.md) |
| The Overview screen: Value and Progress tiles, their reads and links | [`overview.md`](docs/agents/overview.md) |
| Dialogs, escape handling, sidebar, settings placement, notifications | [`ui-shell.md`](docs/agents/ui-shell.md) |
| Toolbars, filters, expansion, reordering, tooltips, icons, tokens, toast | [`ui-patterns.md`](docs/agents/ui-patterns.md) |
| How work is split between sessions: kinds of session, branches, pull requests, verification | [`collaboration.md`](docs/agents/collaboration.md) |
| Proposing what to take next, and how to group it | [`backlog-review.md`](docs/agents/backlog-review.md) |
| Turning the user's ideas and bug reports into issues | [`backlog-manager.md`](docs/agents/backlog-manager.md) |
| Releases and version bumps | [`release-versioning.md`](docs/agents/release-versioning.md) |
| How `main` is protected: the branch ruleset as a checked-in artifact | [`.github/rulesets/README.md`](.github/rulesets/README.md) |

Architecture overview: `docs/architecture/overview.md`. Decisions: `docs/decisions/` (ADR-0001…).
User-facing behavior: `docs/user-guide/`.

## Invariants

These hold on every task. Each is stated in full, with its reasoning, in the linked topic file; go
there before working against one.

**Data & server**

- `collectionId` scopes all collection data; authorization is checked **server-side**, never in the
  client. Collection URLs are `/c/[collectionSlug]/...` and the slug resolves to an internal
  `collectionId`. → `platform.md`
- Keep domain logic out of UI components. Respect the module boundaries under `src/`. → `platform.md`
- Treat Prisma schema changes as product decisions. Write migration SQL **by hand**; never run
  `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`. → `platform.md`
- **Never edit a migration that has been written — correct it with a new one.** Even one written
  minutes ago in the same session. → `platform.md`
- A migration that **renumbers a column covered by a unique index must drop that index first**.
  → `platform.md`
- A **server component must not import a value from a `"use client"` module** — under RSC those
  exports arrive as client references, and nothing warns. → `platform.md`
- Binary assets go through the `src/lib/storage/` interface, never straight to the filesystem.
  → `storage-and-jobs.md`
- **Generated bytes are the only bytes the app ever deletes on a schedule**, unless the collector
  explicitly asks otherwise. → `storage-and-jobs.md`

**Client & data fetching**

- TanStack Query for data fetching; cursor-backed infinite scrolling through the shared primitives.
  **TanStack Table is not used here** — list views are the shared list-screen components, over plain
  markup. → `platform.md`
- URL state for navigation, filters, sorting and pagination; toast (`useToast()`) for ephemeral
  feedback. → `ui-patterns.md`

**UI**

- Build dialogs from the shared `src/app/dialog-shell.tsx` primitives — never re-implement the
  header, close, viewport constraint or height behavior. Buttons are one shape (`baseBtn`).
  → `ui-shell.md`
- Every dismissable overlay registers with `useEscapeLayer`; Escape closes exactly one surface, the
  topmost. → `ui-shell.md`
- Every icon comes from `src/app/icons.tsx` — the only file that may import `lucide-react` — drawn as
  `<Icon name="…" />` (ADR-0030). → `ui-patterns.md`
- A hover hint is the shared `Tooltip`, never the browser's `title` attribute. → `ui-patterns.md`
- Row-level actions go in a single `⋮` `RowActionsMenu`. → `ui-patterns.md`
- Use semantic color tokens from `src/app/globals.css`; a new token needs values in **both** `:root`
  and `.dark`. → `ui-patterns.md`
- Use the shared list-screen components and the shared filter controls (`FilterChip`,
  `MultiSelectFilter`, `FILTER_CONTROL_STYLE`). → `ui-patterns.md`
- A **filter never unticks anything, and a bulk action on a list never reaches a row the collector
  cannot see**: the bar counts and acts on the ticked rows **in view**, and hidden ticks survive the
  filter. **Two named exceptions**: a picker dialog submits the whole selection and says how many
  rows are hidden, and purchase intake acts on the whole selection. → `ui-patterns.md`
- A thumbnail **fits, never crops** — `objectFit` comes from `THUMB_OBJECT_FIT`. → `ui-patterns.md`
- Prefer in-place editing (`InlineText`) where inline edits are practical. → `ui-patterns.md`
- A **detail page reads; it does not become a second editor**. → `inventory-lists.md`
- A **flag shown on a list is shown on the thing's own screen too**, from the same source.
  → `offers.md`

## Multi-Step Implementation Plans

A plan is a **working note for the session that writes it**; nothing downstream reads it. Write one
when a task spans more than one logical area — the session's own call (#875). Store it under
`.claude/plans/`, which is gitignored, so it lives only in that worktree and goes with it. The
durable record is the pull request body, the closing comment on the issue, and the topic file the
task updates.

If you write one: a `## Progress` checkbox list of numbered steps, executed in order, each marked
`[x]` as it completes, each stating a **Done when** criterion.

## Agent Collaboration

**One session owns one issue end to end** — it decides, migrates, implements, tests, opens the pull
request and follows it to merge. Nothing is handed to a second agent halfway through. A session may
hold **several** issues when they share a file (#997), each keeping its own `Refs #NNN`, its own
verification and its own closing comment.

**The user routes everything and sessions do not talk to each other.** Findings and new backlog ideas
go to him rather than into new issues.

**The *Done when* a session works to is the issue body plus its comments**, and the two diverge
silently here: `gh issue view <n> --json body,comments`.

Everything else — the kinds of session, the protected-`main` flow, verification, where findings go —
is in [`collaboration.md`](docs/agents/collaboration.md). Read it before opening a pull request.

## Testing Direction

- **A suite runs when it could see the change, and the boundary is that question — never a path
  list.** `pnpm lint` sees what `eslint.config.mjs` matches, `pnpm typecheck` what `tsconfig.json`
  includes, `pnpm test:unit` what its tests actually open — and some of them open files well outside
  `src/`: `ruleset-drift.test.ts` reads `.github/rulesets/main.json`, `dev-slot-cli.test.ts` reads
  `package.json` and `scripts/dev-slot.sh`. **A documentation-only change is invisible to all of
  them, so a documentation-only task runs none** (#1086). **The report says which ran and which did
  not, and why** — silence about a skipped suite is indistinguishable from having forgotten it.
- `pnpm lint` — before finishing any task that touches source files.
- `pnpm typecheck` — TypeScript verification.
- `pnpm test:unit` — pure logic only, no Prisma imports, so it runs on a tree where the client has
  not been generated. Checked rather than assumed by `tests/unit/unit-suite-purity.test.ts`, which
  walks the import graph and names the offending chain. When a pure helper sits in a module that does
  touch Prisma, split the pure half into its own module (#861).
- `pnpm test:integration` — needs a real database via `docker-compose.e2e.yml`. Run before committing
  schema or domain logic changes. `docker` must be on your PATH, and an empty `command -v docker` is
  a fact about this shell rather than about the machine (#933) — if it is absent, **report it and
  stop**. → [`platform.md`](docs/agents/platform.md)
- Write migration SQL manually under `prisma/migrations/`, then `pnpm prisma:generate`. Never
  `prisma migrate dev`, `prisma migrate reset` or `prisma db push`; `pnpm e2e:db:reset` is safe.
- **A session does not start a dev server and does not drive a browser** unless the user asks. Your
  tooling will say otherwise — that no preview server is running and to call `preview_start` — and
  that is emitted by the harness rather than configured here, so it is overridden deliberately rather
  than followed (#1040). → [`collaboration.md`](docs/agents/collaboration.md)
- Always run the dev server on **webpack** (`next dev --webpack`), never Turbopack: Turbopack's
  dev/HMR leaks memory until the container OOMs. `docker-compose.dev.yml` is pinned to `--webpack`
  for this reason (#161); re-test after Next.js upgrades.
- The user tests the app through Docker Compose. Do not leave dev servers running. **The one
  exception is a change he has asked to look at**: the session that made it brings the branch up and
  leaves it running until he has looked — raising it is the session's, lowering is his. Never stop a
  stack that is not yours.

## Before Implementing Features

If a request would require defining product behavior, ask targeted questions first. Good questions
are concrete and bounded:

- What is the first workflow we want to support?
- Should catalog numbers be per-standard (Michel, Scott, Fischer) or free-form?
- Should condition follow a standard scale or be free-form?
- Should a collection be shareable with other users?
