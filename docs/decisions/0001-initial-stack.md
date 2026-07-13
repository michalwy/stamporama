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
| Tables | TanStack Table |
| Package manager | pnpm |
| Deployment | Docker Compose |

Rationale: well-supported, self-hosting friendly, minimal operational overhead.

## Scoping Model

The top-level organizing unit is a **collection** (`/c/[collectionSlug]/...`). Each user may own multiple collections. All stamp data is scoped to a collection. This is analogous to the common workspace pattern seen in many SaaS tools.

## Consequences

- Image storage for stamp scans is not addressed in this ADR and will require a separate decision when that feature is implemented.
- Future ADRs should document any deviations from this stack.
