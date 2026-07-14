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
│  node server.js (standalone)    │
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
| `builder` | base | build Next.js (`pnpm build`) |
| `runner` | node:22-alpine | minimal runtime image |

`next.config.mjs` sets `output: "standalone"` so the runner stage only needs the files produced by `next build` — no `node_modules` at runtime.

The `STAMPORAMA_VERSION` build argument is baked into the image and exposed at runtime via `process.env.STAMPORAMA_VERSION`. The `getAppVersion()` function in `src/lib/version.ts` reads it.

## CI

The `publish-image` GitHub Actions workflow triggers on `v*` tags and pushes a multi-arch image (`linux/amd64`, `linux/arm64`) to `ghcr.io/michalwy/stamporama`. The image tag and `:latest` are both updated.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | Random secret for auth session signing |
| `BETTER_AUTH_URL` | yes | Public base URL of the app |
| `POSTGRES_PASSWORD` | yes (db) | Password for the `stamporama` database user |
| `TAG` | prod only | Image tag to pull (default: `latest`) |
| `STAMPORAMA_VERSION` | build-time | Baked into the image; set by CI from the git tag |
