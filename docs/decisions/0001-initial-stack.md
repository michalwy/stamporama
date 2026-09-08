# ADR-0001: Initial Stack

## Status

Accepted

## Context

Stamporama needs a web application stack suitable for self-hosting, open-source development, and vibe-coded iteration.

## Decision

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript) |
| Styling | Tailwind CSS |
| ORM | Prisma |
| Database | PostgreSQL |
| Auth | Better Auth |
| Client data | TanStack Query |
| Tables | TanStack Table — **chosen here and never installed; see the note below** |
| Package manager | pnpm |
| Deployment | Docker Compose |

Rationale: well-supported, self-hosting friendly, minimal operational overhead.

**Note added 2026-09-08 (#821): the Tables row was never carried out.** `@tanstack/react-table` is
in no dependency and no source file imports it; list views are built from the shared list-screen
components over plain markup, and the eleven files rendering a `<table>` do so by hand. The row is
left in place because this ADR records what was **decided**, and striking it would erase the
decision rather than its outcome — but it stopped describing the stack at some point nobody
recorded, and `AGENTS.md` and `platform.md` had gone on asserting it as a live invariant for as
long. Choosing a library is not adopting one, and nothing here noticed the difference.

## Scoping Model

The top-level organizing unit is a **collection** (`/c/[collectionSlug]/...`). Each user may own multiple collections. All stamp data is scoped to a collection. This is analogous to the common workspace pattern seen in many SaaS tools.

## Consequences

- Image storage for stamp scans is not addressed in this ADR and will require a separate decision when that feature is implemented.
- Future ADRs should document any deviations from this stack.
