# Architecture Overview

## Deployment Model

Stamporama is deployed as a Docker Compose stack. Three compose files cover different use cases:

| File | Purpose | Command |
|---|---|---|
| `docker-compose.yml` | Base: app + PostgreSQL, built locally | `docker compose up` |
| `docker-compose.dev.yml` | Hot-reload overlay, source mounted | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` |
| `docker-compose.prod.yml` | Self-hosted overlay, prebuilt GHCR image | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` |

The `COMPOSE_FILE` variable in `.env` sets the default file list so operators can run bare `docker compose` commands without specifying `-f` flags.

A fourth file, `docker-compose.e2e.yml`, runs an isolated PostgreSQL instance on port 5433 for integration tests only.

## Services

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

Optional in production:

```
┌─────────────────────────────────┐
│  watchtower  (autoupdate profile│
│  polls GHCR hourly, restarts app│
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
