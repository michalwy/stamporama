# ADR-0001: Initial Stack

## Status

Accepted

## Context

Stamporama needs a web application stack suitable for self-hosting, open-source development, and vibe-coded iteration. The project follows the same deployment and development model as OhmSweetOhm (ohm-sweet-ohm).

## Decision

Use the same core stack as OhmSweetOhm:

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

The stack is battle-tested within this project family, well-supported, and keeps the self-hosting story simple.

## Key Difference from OhmSweetOhm

OhmSweetOhm uses a **workspace** scoping model. Stamporama uses the same pattern but the top-level unit is called a **collection** (`/c/[collectionSlug]/...`). Each user may own multiple collections.

## Consequences

- Future agents should follow the same conventions as OhmSweetOhm unless a new ADR documents a deviation.
- Image storage for stamp scans is not addressed in this ADR and will require a separate decision when that feature is implemented.
