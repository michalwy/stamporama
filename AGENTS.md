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
- **A fact this repository can carry goes in this repository, never only in a session's memory.** Agent memory is machine-local, appears in no pull request, and nothing expires it — a claim about this project written there is read as current by every later session and re-verified by none. Keep in memory only what the repository cannot hold (the user's own working preferences, machine-local facts, pointers outside git), and where an entry does describe this project, make it a pointer to the document rather than a copy of it. **A durable statement carries the command, not the fact the command answers.** And **if what you are reading in the tree contradicts a memory you were given, say so in your report** — you are the only reader holding both halves. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)
- Favor boring, well-supported tools over novelty. Preserve existing user changes.
- Use GitHub Issues as the shared backlog. Use Conventional Commits for issue titles. Always assign labels (`backlog` + type + priority when known). Do not maintain a local `TODO.md`.
- If GitHub connector cannot create issues, use `gh` CLI as fallback.
- All GitHub content must be in English.
- Do not create git commits unless the user explicitly asks. **A commit you were asked to make is pushed in the same breath**, unless the user says otherwise — a task session now pushes to its own branch, and until it does, the work is invisible to the lead and to CI, which is the only place the checks a merge depends on actually run. An unpushed commit also does not survive the worktree being removed.
- **`main` takes no direct pushes.** It is protected with no bypass for anyone, the user included: a pull request is the only way in, rebase merge only, linear history, force-push and deletion blocked, and five required checks (`Static checks`, `Unit tests`, `Integration tests`, `Extension checks`, `Closing reference check`). Work happens on `task/<issue>-<slug>`, branched from `main`; the session opens the pull request and reports back, and the lead merges it. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)
- **A branch behind `main` is rebased and then re-verified, in that order:** fetch, rebase the branch onto `main`, run the checks again, force-push the branch. The re-run is the half that is easy to drop and the only half that is interesting — a suite that was green before the rebase was green against a different `main`, and all it establishes is that the branch worked in isolation. **This holds for a branch still being worked on, and that is a state rather than a one-way door**: it pauses when the session pushes and reports, and starts again the moment the session is re-briefed — by the lead or by the user. Between the report and the next brief the lead updates the branch and reads the run; GitHub does not do it here. **Force-push with `--force-with-lease`, never bare `--force`** — it is what turns a collision on that boundary into a refusal somebody has to read instead of silent loss (#984). Add `pnpm install` between the rebase and the suites when the rebase pulled in a lockfile change. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, etc. Include GitHub issue reference when one exists — as `Refs #NNN`, or as the `(#NNN)` suffix a commit title already uses. **Never a closing keyword** (`Closes`, `Fixes`, `Resolves` or their variants), in a commit message or a pull request body: GitHub acts on it the moment the change lands on `main` and closes the issue there and then, which is the lead's step, after verification. A parenthetical saying otherwise does not help — that is how #780 was closed before anybody had read its *Done when*. The keyword counts wherever it lands, prose included — and a code span is the one place it does not, which is how a body may safely quote the trap. Read the result back instead of the text: `gh pr view <n> --json closingIssuesReferences` must return `[]`. **That query sees the body only, never a commit message** (#790), so the `Closing reference check` job in CI is what actually covers both halves of this rule. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)
- When a commit title alone would omit useful context, include an extended commit message body.
- **An assignment begins with the wake-up drill, unconditionally**: `git fetch origin main`, cut `task/<issue>-<slug>` from `origin/main`, `pnpm install`, then **`pnpm prisma:generate`**. The last step looks redundant and is not. A pooled worktree may be hours old when it is assigned, and if `main` has taken a migration since, `pnpm install` reports *Already up to date*, skips the postinstall, and leaves a Prisma client that is **stale rather than missing** — which compiles, and whose tests pass against a schema the branch no longer declares (#862). Regenerating costs seconds; a stale client looks exactly like a sound one. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)
- **Each task session works in its own git worktree**, which comes with the session; the main checkout stays the user's. Sessions run in parallel, so never assume you are the only one working — stage only your own task's paths, and treat `main` as moving underneath you. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)

## Topic Map

Read the file for the area you are touching. Each one carries the decisions and the reasoning behind them, with issue and ADR references.

| Touching… | Read |
| --- | --- |
| Stack, routing, auth, Prisma/Postgres, migrations, RSC boundaries, deployment | [`docs/agents/platform.md`](docs/agents/platform.md) |
| Photos and binary assets, background jobs, upload caps, retention and deletion | [`docs/agents/storage-and-jobs.md`](docs/agents/storage-and-jobs.md) |
| The `extension/` package, Colnect matcher, marks drawn on marketplace pages | [`docs/agents/extension.md`](docs/agents/extension.md) |
| Colnect list sync: list mappings, list snapshots, the discrepancy report | [`docs/agents/colnect-list-sync.md`](docs/agents/colnect-list-sync.md) |
| Allegro API access, sync worklist, listing profiles, categories, publishing | [`docs/agents/allegro.md`](docs/agents/allegro.md) |
| Delcampe platform marker, listing profiles, Easy Uploader defaults | [`docs/agents/delcampe.md`](docs/agents/delcampe.md) |
| Offers, listing texts, listing kit, offer pricing, offer screens | [`docs/agents/offers.md`](docs/agents/offers.md) |
| Auction sales and lots, bid anchors, bid recommendations, auction screens | [`docs/agents/auctions.md`](docs/agents/auctions.md) |
| Market value, catalogue value, the Valuation dialog | [`docs/agents/valuation.md`](docs/agents/valuation.md) |
| Purchases, intake, scan-sheet ingest, delivery/disposal, sorting, storing, ROI | [`docs/agents/purchases-and-intake.md`](docs/agents/purchases-and-intake.md) |
| Trades, trade sections and lines, balancing, the trade lifecycle | [`docs/agents/trades.md`](docs/agents/trades.md) |
| Stamps, issues, formats, subtypes, catalog numbers, checklists, wants | [`docs/agents/catalog-and-stamps.md`](docs/agents/catalog-and-stamps.md) |
| Copies list, grouping, duplicates, copy counts, detail pages | [`docs/agents/inventory-lists.md`](docs/agents/inventory-lists.md) |
| Albums and their entries, page plans, hawid stock and the box rule, album templates | [`docs/agents/albums.md`](docs/agents/albums.md) |
| The Overview screen: Value and Progress tiles, their reads and links | [`docs/agents/overview.md`](docs/agents/overview.md) |
| Dialogs, escape handling, sidebar, settings placement, notifications | [`docs/agents/ui-shell.md`](docs/agents/ui-shell.md) |
| Toolbars, filters, expansion, reordering, tooltips, icons, tokens, toast | [`docs/agents/ui-patterns.md`](docs/agents/ui-patterns.md) |
| Splitting work between sessions: the lead, task sessions, branches and pull requests | [`docs/agents/collaboration.md`](docs/agents/collaboration.md) |
| Backlog review workflow | [`docs/agents/backlog-review.md`](docs/agents/backlog-review.md) |
| Releases and version bumps | [`docs/agents/release-versioning.md`](docs/agents/release-versioning.md) |
| How `main` is protected: the branch ruleset, as a checked-in artifact rather than as prose | [`.github/rulesets/README.md`](.github/rulesets/README.md) |

Architecture overview: `docs/architecture/overview.md`. Decisions: `docs/decisions/` (ADR-0001…). User-facing behavior: `docs/user-guide/`.

## Invariants

These hold on every task, whatever you are building. Each is stated in full — with its reasoning — in the linked topic file; go there before working against one.

**Data & server**

- `collectionId` scopes all collection data; authorization is checked **server-side**, never in the client. Collection URLs are `/c/[collectionSlug]/...` and the slug resolves to an internal `collectionId`. → `platform.md`
- Keep domain logic out of UI components. Respect the explicit module boundaries under `src/`. → `platform.md`
- Treat Prisma schema changes as product decisions. Write migration SQL **by hand**; never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`. → `platform.md`
- **Never edit a migration that has been written — correct it with a new one.** Applies even to one written minutes ago in the same session and not yet committed. → `platform.md`
- A migration that **renumbers a column covered by a unique index must drop that index first**. → `platform.md`
- A **server component must not import a value from a `"use client"` module** — under RSC those exports arrive as client references, and nothing warns. → `platform.md`
- Binary assets go through the `src/lib/storage/` interface, never straight to the filesystem. → `storage-and-jobs.md`
- **Generated bytes are the only bytes the app ever deletes on a schedule** — unless the collector explicitly asks otherwise. → `storage-and-jobs.md`

**Client & data fetching**

- TanStack Query for data fetching; cursor-backed infinite scrolling through the shared primitives. **TanStack Table is not used here** — list views are the shared list-screen components below, over plain markup. → `platform.md`
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

A plan is a **working note for the session that writes it**, and nothing downstream reads it. Write one when a task spans more than one logical area and setting the steps out first would help — that is the session's own call and no longer a requirement (#875). Store it under `.claude/plans/`. A plan is executed fully within a single session.

**It does not persist, and that is now by design rather than by accident.** `.claude/` is gitignored (`git ls-files .claude/plans` returns 0), so the plan lives only in the session's own worktree and is gone when the lead removes that worktree after the merge. Nothing is lost with it, because **the durable record is the pull request body, the closing comment on the issue, and the topic file the task updates** — all three in git, all three read. So do not treat the plan as the record of the work and do not write it for a reader; it is for you, while you are working. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)

If you write one, keep the shape — it is what makes the note useful to its author:

- Begin with a `## Progress` section containing a checkbox list of numbered steps.
- Steps are executed in order. Mark each step `[x]` immediately after completing it.
- Each step must state a **Done when** criterion.

## Agent Collaboration

**One session owns one issue end to end** — it decides, migrates, implements, tests and opens the pull request itself. Nothing is handed to a second agent halfway through.

The rest of the model — the long-lived lead session, how a task session is spawned and how it reaches the lead, the protected-`main` flow, what runs in parallel, and where findings and new backlog items go — is in [`docs/agents/collaboration.md`](docs/agents/collaboration.md). Read it before spawning a session or opening a pull request.

## Testing Direction

- `pnpm lint` — run before finishing any task that touches source files.
- `pnpm typecheck` — TypeScript verification.
- `pnpm test:unit` — pure logic only, no Prisma imports, so it runs on a tree where the client has not been generated. **Checked, not assumed**: `tests/unit/unit-suite-purity.test.ts` walks the suite's import graph and fails on any path that reaches one, naming the chain. Three files had quietly broken this rule, and the failure they produced — `Cannot find module` — reads as a broken checkout rather than a broken test. When a pure helper sits in a module that does touch Prisma, split the pure half into its own module (#861).
- `pnpm test:integration` — requires real database via `docker-compose.e2e.yml`. Run before committing schema or domain logic changes. **`docker` must be on your PATH**, and an empty `command -v docker` is a fact about this shell's PATH rather than about the machine (#933): a session inherits its PATH from whatever launched it, so it can be older than the machine's configuration. If it is absent, **report that and stop** — do not conclude Docker is not installed, and do not go hunting for the binary. → [`docs/agents/platform.md`](docs/agents/platform.md)
- Write migration SQL manually. Create directory and `migration.sql` by hand under `prisma/migrations/`. Then `pnpm exec prisma generate`.
- Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` directly. Exception: `pnpm e2e:db:reset` is safe.
- **A session does not start a dev server**, and does not drive a browser, unless the user explicitly asks. Verification here is `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` and `pnpm test:integration`, and the report says which of them ran. The lead's showcase is the one exception and it is the lead's alone — see the bullet below. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)
- Always run the dev server on **webpack** (`next dev --webpack`), never the default Turbopack: Turbopack's dev/HMR leaks memory until the container OOMs (an open, idle browser tab grows the server heap unbounded; webpack plateaus). The `docker-compose.dev.yml` overlay is pinned to `--webpack` for this reason. See issue #161; re-test Turbopack after Next.js upgrades and revert once fixed upstream.
- The user tests the app through Docker Compose. Do not leave dev servers running. **The one exception is the lead's showcase**: when a change is one a person looks at, the lead brings the branch up in the main worktree for the user and leaves it running until he has looked — raising it is the lead's, lowering it is the user's alone. That exception is the showcase and nothing else: a task session still starts nothing, and the lead starts nothing for its own verification. Never stop a stack that is not yours. → [`docs/agents/collaboration.md`](docs/agents/collaboration.md)

## Before Implementing Features

If a request would require defining product behavior, ask targeted questions first. Good questions are concrete and bounded:

- What is the first workflow we want to support?
- Should catalog numbers be per-standard (Michel, Scott, Fischer) or free-form?
- Should condition follow a standard scale or be free-form?
- Should a collection be shareable with other users?
