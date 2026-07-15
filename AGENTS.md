# Agent Instructions

This project is intentionally vibe-coded. Future agents must preserve product intent, avoid invented requirements, and ask clarifying questions when the next step is not clear.

## Product Context

- Product name: Stamporama
- Repository/package name: stamporama
- Purpose: a self-hosted web app for stamp collectors
- Target platform: desktop browsers only; do not design, implement, or test mobile-specific behavior
- Application language: English first, additional languages later
- Core concept: **collection** — the top-level organizing unit that scopes all stamp data for a user

## Working Rules

- Do not assume domain behavior. Ask before defining catalog standards, condition scales, trade workflows, auction integration behavior, or pricing logic.
- When clarifying product behavior, ask one question at a time and wait for the answer before asking the next question.
- Do not add user-facing functionality unless the current task explicitly asks for it.
- Keep user-facing copy in English.
- Structure new user-facing strings so future localization is possible.
- Prefer small, reversible changes with clear documentation.
- When changing user-visible behavior, update `docs/user-guide/` in the same task so end-user documentation stays current.
- When changing behavior, data model, setup flow, or architecture assumptions, update every affected document in the same task (`README.md`, `docs/product/brief.md`, `docs/architecture/overview.md`, relevant ADRs, and `docs/user-guide/`).
- Before finishing a task that changes application behavior, explicitly verify documentation consistency.
- When introducing a framework, library, or major pattern, add or update an ADR in `docs/decisions/`.
- Update this `AGENTS.md` file when new project knowledge, workflow rules, or collaboration preferences would help future agents work better.
- Keep the project runnable locally and deployable to cloud infrastructure.
- Favor boring, well-supported tools over novelty.
- Preserve existing user changes. Do not rewrite unrelated files.
- Use GitHub Issues as the shared backlog for explicitly requested but unfinished work. Before starting related work, check whether an issue already exists; if not, create one. When an item is completed, close the corresponding issue by including a closing keyword in the commit message (e.g. `Closes #5`). Only use `gh issue close` directly when no commit is being made.
- Do not close a GitHub Issue until the implementation is committed and pushed (or intentionally handed off unpushed at explicit user request).
- Use Conventional Commits format for issue titles, matching the commit type that will close the issue: `feat: add catalog search`, `fix: collection slug collision`, `docs: update agent guidance`, `question: define catalog hierarchy`.
- When creating or updating backlog issues, always assign appropriate labels during the same task. At minimum, apply `backlog` plus one type label (`enhancement`, `bug`, `question`), and add priority labels when known.
- Do not maintain a local `TODO.md` backlog file. Keep backlog items only in GitHub Issues.
- If GitHub connector/integration cannot create or update issues, use `gh` CLI as the required fallback.
- All GitHub content must be in English: issue titles, issue comments, PR titles, PR descriptions, and commit messages.
- Do not create git commits unless the user explicitly asks for a commit. Do not push unless the user explicitly asks to push.
- This is currently a solo project. When the user asks for a commit, commit directly to `main` by default after appropriate local verification.
- When pushing to `main`, try `git push origin main` first. If rejected, fetch remote, rebase local commits onto `origin/main`, rerun verification, and push again.
- Create a feature branch and pull request only when the user explicitly asks for a PR.
- Use a separate git worktree only when the user explicitly asks for one. Do not create worktrees based on an agent's own risk assessment.
- Do not push broken or unverified work unless the user explicitly asks to checkpoint it.
- Use Conventional Commits: `feat: add catalog search`, `fix: collection slug collision`, `docs: update agent guidance`.
- Include a GitHub issue reference in every commit message when an issue exists for the work.
- When a commit title alone would omit useful context, include an extended commit message body with concise details about motivation, scope, or notable tradeoffs.

## Backlog Review

When asked to review the backlog and propose next steps:

- Always start with `gh issue list --state open --limit 100` to get the full picture. Never rely on recently closed issues or git log alone — new issues can appear at any time.
- Always check `gh release list` fresh to know the current version. Never assume it from memory or a prior git log in the same session.
- Present results in two sections:
  - **Najbliższe** (2–3 next sessions): three-column table with columns `Sesja`, `Temat` (short theme label), `Opis` (issue links + description, `<br>`-separated when multiple), and `Dlaczego?` (one sentence rationale). No separate Issues column — embed issue links in Opis.
  - **Dalsze** (beyond that): table with columns `Track`, `Opis`, `Dlaczego?` — high-level track descriptions only, no per-session breakdown.
- Before proposing session order for near-term issues, check the "Depends on" section of each issue body (`gh issue view <n> --json body`). Never schedule an issue before its open dependencies are closed.
- Do not ask the user which direction to pursue — just present the plan and let them redirect.
- Proactively suggest when it is a good time to cut a release: after a coherent batch of shippable commits has accumulated since the last tag. Only suggest — do not cut the release yourself; that is handled by a separate agent.

## Release Versioning

- Never assume the last released version from memory or from local git tags cached mentally — always run `gh release list` fresh, since a release agent can tag a new version mid-session outside this agent's awareness.
- When asked to cut a new version, first review the changes merged since the previous released tag, then decide patch vs minor based on that review (`feat:` commits → minor, `fix:`/`chore:` only → patch).
- Never bump the major version unless the user explicitly asks for a major bump.
- After tagging and pushing a new version, always create a GitHub Release for that tag (`gh release create vX.Y.Z --title vX.Y.Z --generate-notes`) automatically, without waiting to be asked.
- After creating the GitHub Release, move the `latest` git tag to the same commit and force-push it: `git tag -f latest vX.Y.Z && git push origin latest --force`. This keeps `scripts/install.sh`, `scripts/update.sh`, and `docker-compose.prod.yml` in sync with the released image.
- If, after reviewing the changes since the previous tag, a new release does not seem warranted (e.g. no user-facing or shippable changes), do not skip or proceed silently — ask the user for confirmation before deciding either way.
- Always write a proper, human-readable release description instead of relying on bare `--generate-notes` output. Group changes into sections (e.g. Highlights/Fixes/Other), summarize each commit/PR in plain English with its reference number, and keep the auto-generated "Full Changelog" compare link at the end.
- In backlog-review sessions, only suggest a release — do not prepare, tag, push, or create it yourself. Release preparation is handled by a separate dedicated agent.

## Multi-Step Implementation Plans

When a task spans more than one logical area, write an implementation plan before starting. Store it under `.claude/plans/`. A plan is executed fully within a single session.

- Begin with a `## Progress` section containing a checkbox list of numbered steps.
- Steps are executed in order. Mark each step `[x]` immediately after completing it — never batch updates.
- Each step must state a **Done when** criterion.

Example progress block:
```
## Progress
- [x] Step 1 — Create shared component
- [ ] Step 2 — Refactor existing component to use it
- [ ] Step 3 — Update page files
```

## Agent Collaboration

Use specialized roles only when the task benefits from them. Small, localized documentation, copy, styling, or bug-fix tasks can be handled by one careful agent.

Use specialized roles for larger or riskier changes that cross domain, data, authorization, or user-flow boundaries:

- Architect for architectural decisions, ADRs, schema boundaries, and major patterns.
- Designer for meaningful UI flows, dialogs, tables, and interaction design.
- Developer for scoped implementation once behavior is clear.
- Tester/Reviewer for browser flows, regressions, and verification.

Prefer involving Architect before changing Prisma schema, permissions, collection scoping, authentication, routing conventions, or ADR-documented patterns.

Prefer involving Tester/Reviewer after changing forms, dynamic tables, dialogs, collection routing, authentication, permissions, or migrations.

Do not use multiple roles to invent product behavior. Product decisions still require clarification.

## Technical Direction

- Use TypeScript throughout application code.
- Use Next.js App Router conventions.
- Use collection-scoped access control: users are global, collection data carries `collectionId`, the collection owner has full access, and access control checks live in server-side code.
- Collection URLs use `/c/[collectionSlug]/...`; slug resolution must authorize by internal `collectionId`.
- Use Better Auth for authentication; do not introduce development current-user shortcuts.
- Use Prisma with PostgreSQL for persistence.
- Keep Next.js, React, and TypeScript as the frontend direction unless a future ADR documents a specific reason to migrate.
- Use the SPA-like collection interaction model: keep Next.js App Router as the route/auth shell, but prefer client-side queries and mutations for rich collection lists, dialogs, inline editing, and repeated list actions once those screens need responsive behavior.
- Large collection lists are expected to grow beyond client-side full loading. Prefer cursor-backed endless scrolling/infinite loading for stamps and future large lists, and implement shared list primitives instead of custom endless-scroll behavior per screen.
- Add browser interactivity with focused client components; do not make the whole app client-rendered by default.
- Prefer established React ecosystem libraries for complex tables, dialogs, forms, validation, and accessible UI primitives when those needs become concrete.
- Use TanStack Query for client-side data fetching in collection screens. Use TanStack Table for rich list views. When adding or upgrading these libraries, verify the latest stable npm versions and do not pin older versions without a documented compatibility reason.
- Treat database schema changes as product decisions, not incidental implementation details.
- Treat new domain resources as collection-scoped by default. Add `collectionId` and scope server-side queries/mutations to the current collection unless an explicit product decision says the resource is global.
- Keep authorization checks in server-side application/domain code, not UI components.
- Keep domain logic out of UI components as the app grows.
- Prefer explicit module boundaries under `src/`.
- Keep Docker Compose suitable for local use and development, not as the only deployment path.
- Treat `docker compose up` as the user's normal local-use stack: it should run the built app with `next start` against the persistent development database, without creating a seeded development user.
- Use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` for containerized development with hot reload.
- A self-hosted deployment path exists for real servers (e.g. Raspberry Pi): CI's `publish-image` job pushes a multi-arch image to `ghcr.io/michalwy/stamporama` **only for release tags (`v*`)** — not on every `main` commit. `docker-compose.prod.yml` runs that prebuilt image against an operator-provided external database with all config in a git-ignored `.env` (template `.env.prod.example`), and `scripts/install.sh` is the curl-able installer. Deployment management commands run as bare `docker compose ...` from the install dir, reading the file list from the `COMPOSE_FILE` key in `.env`. Optional auto-update uses Watchtower under the `autoupdate` compose profile. The release version is baked into the image via the `STAMPORAMA_VERSION` build arg and shown in the app through `getAppVersion()` in `src/lib/version.ts`. Keep these in sync when changing runtime env vars, migrations-on-start behavior, or the Dockerfile `runner` target.
- Keep dependencies reasonably current; avoid leaving generated scaffolds pinned to old major versions without a documented compatibility reason.

## UI Direction

- Desktop-only application. Do not add mobile layouts, responsive mobile breakpoints, mobile navigation patterns, or mobile-specific fallbacks unless a future product decision explicitly reverses this.
- Use modal dialogs for list actions such as adding, editing, and similar focused workflows.
- Build modal dialogs with the shared `src/app/dialog-shell.tsx` primitives. Do not duplicate dialog header, close button, viewport constraint, or default-tab height behavior in feature components; extend the shared shell first when a dialog needs a new common capability.
- Treat tabs inside dialogs as visual grouping only. A dialog must have one logical save action that persists values from all tabs and then closes the dialog when the save succeeds.
- For all current and future dialogs, let the dialog height be determined by the primary/default tab content. The dialog may be constrained by the viewport; if content would exceed the viewport, only the dialog body should scroll while the header and footer remain fixed. Switching tabs must not change the dialog height.
- Prefer in-place editing on lists for fields where inline edits are practical and clear.
- Build list screens on shared base components/primitives for common behavior such as loading state, empty state, filters, table layout, and endless scrolling. Extend the shared primitives first when multiple lists need the same capability.
- For rich collection screens, reserve URL state for navigation, filters, sorting, pagination, selected records, and deep-linkable UI. Do not put ephemeral success feedback in URL parameters; use local toast feedback instead.
- Use the semantic color tokens defined in `src/app/globals.css` for UI intent such as accent, success, error, warning, and primary actions instead of hard-coding black action buttons.

## Testing Direction

- Use `pnpm lint` for ESLint verification. Run it before finishing any task that touches source files. Fix all errors; warnings may be left as-is.
- Use `pnpm typecheck` for TypeScript verification.
- Use `pnpm test:unit` for unit tests (`tsx --test tests/unit/**/*.test.ts`). Unit tests must not import Prisma or any server infrastructure — pure logic only.
- Use `pnpm test:integration` for server-side integration tests that require a real database. Integration tests live in `tests/integration/`, use `node:test` (not `@playwright/test`), and run against the isolated e2e PostgreSQL service in `docker-compose.e2e.yml`. A `tests/integration/tsconfig.json` with a `server-only` shim is required — do not remove it. `pnpm test:integration` starts the DB container, applies pending migrations, and runs the tests. It does NOT reset or re-seed the database; use `pnpm e2e:db:reset` separately if a clean slate is needed.
- E2E (browser-level) testing is not yet set up. Do not add e2e test files until the infrastructure is in place.
- Keep integration tests pointed at the isolated PostgreSQL service in `docker-compose.e2e.yml`, not the normal development database.
- Add or update integration test coverage when changing collection mutations, concurrency-sensitive logic, or other server-side domain rules.
- Before finishing any task that changes server-side mutations or domain logic, run `pnpm test:integration` and confirm all tests pass.
- Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` directly — these touch the user's development database. When a schema change is needed, generate only the migration SQL file with `pnpm exec prisma migrate dev --create-only --name <name>`. Exception: `pnpm e2e:db:reset` runs `prisma migrate reset` against the isolated e2e database and is always safe to invoke.
- The user tests the app through Docker Compose. Do not leave manually started dev servers running for handoff.
- If an agent starts a manual local dev server for verification, it must stop that server before finishing the turn.
- When starting a local Next.js dev server manually for browser verification, use webpack mode: `pnpm exec next dev --webpack -p 3002`. Avoid Turbopack for local verification — it has produced unstable dev-server failures in similar projects.

## Before Implementing Features

If a request would require defining product behavior, ask targeted questions first. Good questions are concrete and bounded:

- What is the first workflow we want to support?
- Should catalog numbers be per-standard (Michel, Scott, Fischer) or free-form?
- Should condition follow a standard scale or be free-form?
- Should a collection be shareable with other users?
