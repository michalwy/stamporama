# Architecture Overview

## Deployment Model

Stamporama uses separate Docker Compose files for local development and self-hosted production.

| File | Purpose | Command |
|---|---|---|
| `docker-compose.yml` | Local dev: app + bundled PostgreSQL, built locally | `docker compose up` |
| `docker-compose.dev.yml` | Hot-reload overlay, source mounted | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` |
| `docker-compose.prod.yml` | Self-hosted production: prebuilt GHCR image, external DB | `docker compose -f docker-compose.prod.yml up -d` |
| `docker-compose.network.yml` | Optional overlay: connect app to a shared Docker network for DB access | combined with `docker-compose.prod.yml` via `COMPOSE_FILE` |
| `docker-compose.e2e.yml` | Isolated PostgreSQL on port 5433 for integration tests | started by `pnpm test:integration` |

The `COMPOSE_FILE` variable in `.env` sets the active file list so operators can run bare `docker compose` commands without specifying `-f` flags.

## Local development services

```
┌─────────────────────────────────┐
│  app  (Next.js, port 3000)      │
│  pnpm start (next start)        │
└──────────────┬──────────────────┘
               │ DATABASE_URL
               ▼
┌─────────────────────────────────┐
│  db  (PostgreSQL 16, port 5432) │
│  volume: db_data                │
└─────────────────────────────────┘
```

## Production services

Production does not run a database container. The operator provides an external PostgreSQL via `DATABASE_URL`.

```
┌─────────────────────────────────┐
│  app  (Next.js, port 3000)      │
│  ghcr.io/michalwy/stamporama    │
└──────────────┬──────────────────┘
               │ DATABASE_URL (external)
               ▼
         [operator's PostgreSQL]

Optional (autoupdate profile):
┌─────────────────────────────────┐
│  watchtower                     │
│  polls GHCR, restarts on update │
└─────────────────────────────────┘
```

## Docker Image

The `Dockerfile` uses four stages:

| Stage | Base | Purpose |
|---|---|---|
| `base` | node:22-alpine | corepack + pnpm |
| `deps` | base | install dependencies only |
| `builder` | base | generate Prisma client + build Next.js |
| `runner` | node:22-alpine | runtime image with full `node_modules` |

The runner stage ships the full `node_modules` (not Next.js standalone output), so `pnpm start` works without re-installing. `pnpm-workspace.yaml` is copied to the runner as a safety net for the build-scripts allowlist.

The `STAMPORAMA_VERSION` build argument is baked into the image and exposed at runtime via `process.env.STAMPORAMA_VERSION`. The `getAppVersion()` function in `src/lib/version.ts` reads it.

## Prisma / Database

Stamporama uses [Prisma](https://www.prisma.io/) with the `@prisma/adapter-pg` driver adapter. The adapter uses the `pg` npm package for PostgreSQL connections — no native query engine binary is required.

**Generated client:** `pnpm prisma:generate` writes the TypeScript client to `src/generated/prisma/`. This directory is generated and should not be edited by hand; it is committed to the repository so that CI jobs that do not run `prisma:generate` before type-checking can still compile.

**Migration workflow:**

| Context | Command | Notes |
|---|---|---|
| Local development | `pnpm prisma:migrate` | Applies + generates new migration against local dev DB |
| Integration tests | `pnpm exec prisma migrate deploy` | Applied automatically by `pnpm test:integration` |
| CI (integration job) | `pnpm exec prisma migrate deploy` | Runs against a fresh service-container DB |
| Production | Run `pnpm exec prisma migrate deploy` before restarting the container | Operator responsibility |

**Schema:** `prisma/schema.prisma` — PostgreSQL datasource, client output at `src/generated/prisma`.

**Config:** `prisma.config.ts` — loads `DATABASE_URL` from the environment (via dotenv), sets schema and migrations paths.

**Client singleton:** `src/lib/db.ts` — exports `prisma`, a `PrismaClient` instance initialized with the `PrismaPg` adapter. Uses `globalThis` caching to avoid exhausting connections during Next.js hot-reload.

## CI

The `ci.yml` GitHub Actions workflow runs three jobs on every push and pull request:

- **static-checks** — lint, typecheck, build (generates Prisma client first)
- **unit** — unit tests (generates Prisma client first)
- **integration** — spins up a PostgreSQL 16 service container, applies migrations via `prisma migrate deploy`, then runs `tests/integration/`

The **publish-image** job triggers only on `v*` tags and requires all three jobs to pass. It pushes a multi-arch image (`linux/amd64`, `linux/arm64`) to `ghcr.io/michalwy/stamporama`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | Random secret for auth session signing |
| `BETTER_AUTH_URL` | yes | Public base URL of the app |
| `POSTGRES_PASSWORD` | yes (db) | Password for the `stamporama` database user |
| `TAG` | prod only | Image tag to pull (default: `latest`) |
| `STAMPORAMA_VERSION` | build-time | Baked into the image; set by CI from the git tag |
