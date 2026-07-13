# Agent Instructions

This project is intentionally vibe-coded. Future agents must preserve product intent, avoid invented requirements, and ask clarifying questions when the next step is not clear.

## Product Context

- Product name: Stamporama
- Repository/package name: stamporama
- Purpose: a self-hosted web app for stamp collectors
- Target platform: desktop browsers only; do not design, implement, or test mobile-specific behavior
- Application language: English first, additional languages later
- Core concept: **collection** — the top-level organizing unit, analogous to a workspace in OhmSweetOhm

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
- When creating or updating backlog issues, always assign appropriate labels during the same task. At minimum, apply `backlog` plus one type label (`enhancement`, `bug`, `question`), and add priority labels when known.
- Do not maintain a local `TODO.md` backlog file. Keep backlog items only in GitHub Issues.
- If GitHub connector/integration cannot create or update issues, use `gh` CLI as the required fallback.
- All GitHub content must be in English: issue titles, issue comments, PR titles, PR descriptions, and commit messages.
- Do not create git commits unless the user explicitly asks for a commit. Do not push unless the user explicitly asks to push.
- This is currently a solo project. When the user asks for a commit, commit directly to `main` by default after appropriate local verification.
- When pushing to `main`, try `git push origin main` first. If rejected, fetch remote, rebase local commits onto `origin/main`, rerun verification, and push again.
- Create a feature branch and pull request only when the user explicitly asks for a PR.
- Use Conventional Commits: `feat: add catalog search`, `fix: collection slug collision`, `docs: update agent guidance`.
- Include a GitHub issue reference in every commit message when an issue exists for the work.

## Release Versioning

- Never assume the last released version from memory — always check GitHub directly.
- When asked to cut a new version, review changes since the previous tag, then decide patch vs minor (`feat:` → minor, `fix:`/`chore:` only → patch).
- Never bump the major version unless the user explicitly asks.
- After tagging, always create a GitHub Release (`gh release create vX.Y.Z --title vX.Y.Z --generate-notes`).
- Write a proper human-readable release description grouping changes into sections.

## Multi-Step Implementation Plans

When a task spans more than one logical area or cannot be safely completed in a single session, write an implementation plan before starting. Store it under `.claude/plans/`. Plans must follow these rules:

- Steps are always executed in order.
- Begin with a `## Progress` section with a checkbox list.
- Mark a step `[~]` at the start, `[x]` immediately after finishing — before ending the session.
- Each step must be atomic and independently verifiable.
- Each step must state a **Done when** criterion.
- Later steps must not assume context from earlier sessions — all necessary detail must be in the plan file.

## Technical Direction

- Use TypeScript throughout application code.
- Use Next.js App Router conventions.
- Use collection-scoped access control: users are global, collection data carries `collectionId`, the collection owner has full access, and access control checks live in server-side code.
- Collection URLs use `/c/[collectionSlug]/...`; slug resolution must authorize by internal `collectionId`.
- Use Better Auth for authentication; do not introduce development current-user shortcuts.
- Use Prisma with PostgreSQL for persistence.
- Use TanStack Query for client-side data fetching in collection screens.
- Use TanStack Table for rich list views.
- Treat database schema changes as product decisions, not incidental implementation details.
- Treat new domain resources as collection-scoped by default. Add `collectionId` and scope server-side queries/mutations to the current collection unless an explicit product decision says the resource is global.
- Keep authorization checks in server-side application/domain code, not UI components.
- Keep domain logic out of UI components as the app grows.
- Prefer explicit module boundaries under `src/`.
- Keep Docker Compose suitable for local use and development, not as the only deployment path.
- Use `docker compose up` as the normal local-use stack.
- Use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` for development with hot reload.
- A self-hosted deployment path exists for real servers: CI publishes a multi-arch image to `ghcr.io/michalwy/stamporama` only for release tags (`v*`). `docker-compose.prod.yml` runs the prebuilt image with config in a git-ignored `.env`.
- Keep dependencies reasonably current.

## UI Direction

- Desktop-only application. Do not add mobile layouts or responsive mobile breakpoints.
- Use modal dialogs for list actions (add, edit, delete).
- Prefer in-place editing on lists where practical.
- Build list screens on shared primitives for loading state, empty state, filters, table layout, and pagination.
- Use semantic color tokens defined in `src/app/globals.css` for UI intent.

## Testing Direction

- Use `pnpm lint` for ESLint verification before finishing any task that touches source files.
- Use `pnpm typecheck` for TypeScript verification.
- Unit tests live in `tests/unit/`, use `node:test`, no Prisma or server infrastructure.
- Integration tests live in `tests/integration/`, use a real database from `docker-compose.e2e.yml`.
- Never run `prisma migrate dev` or `prisma migrate reset` directly against the development database. Use `pnpm exec prisma migrate dev --create-only --name <name>` to generate migration SQL only.

## Before Implementing Features

If a request would require defining product behavior, ask targeted questions first. Good questions are concrete and bounded:

- What is the first workflow we want to support?
- Should catalog numbers be per-standard (Michel, Scott, Fischer) or free-form?
- Should condition follow a standard scale or be free-form?
- Should a collection be shareable with other users?
