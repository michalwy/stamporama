# Stamporama

A self-hosted web application for stamp collectors.

Stamporama helps you manage your stamp collection, track trades and purchases, hunt for new stamps, and keep everything in one place.

## Features (planned)

- **Catalog** — stamps you own, by catalog number, series, topic, and country
- **Collection** — condition, acquisition details, storage locations, photos, duplicates for trade or sale
- **Trading** — agree on scope, track progress with other collectors
- **Purchases & Sales** — what you bought and sold, prices, profit/loss
- **Stamp hunting** — want list, auction tracking, price history
- **Integrations** — Collnect, Delcampe

## Self-hosting

Install Docker, then run:

```sh
curl -fsSL https://raw.githubusercontent.com/michalwy/stamporama/latest/scripts/install.sh | bash
```

The installer downloads the compose files, walks you through environment configuration, and starts the stack. Stamporama will be available on port 3000.

To manage the running stack:

```sh
cd ~/stamporama
docker compose ps
curl -fsSL https://raw.githubusercontent.com/michalwy/stamporama/latest/scripts/update.sh | bash   # update to latest release
docker compose down                                                                                   # stop
```

Optional auto-update via [Watchtower](https://containrrr.dev/watchtower/):

```sh
docker compose --profile autoupdate up -d
```

Uploaded photos are stored in the `stamporama-data` Docker volume (mounted at `/data`) by default. Back it up alongside your database — losing the volume loses the images.

Alternatively, photos can be stored in **Google Cloud Storage**. Set `STAMPORAMA_STORAGE_BACKEND=gcs` plus `STAMPORAMA_GCS_BUCKET` and mount a service-account key (`GOOGLE_APPLICATION_CREDENTIALS`); see the GCS section of `.env.prod.example`. Photos are served via short-lived signed URLs so bytes bypass the app. Switching is safe at any time — existing filesystem photos keep serving from the volume while new photos write to GCS, and the optional `pnpm photos:migrate:gcs` command moves old photos across so the volume can be retired.

## Development

Prerequisites: Docker, Node.js 22+, pnpm. Self-hosting against an external database requires **PostgreSQL 15+** (the bundled containers use Postgres 16).

**Run the standard local stack** (built image, `next start`):

```sh
docker compose up --build
```

App is available at <http://localhost:3000>.

**Run with hot-reload** (mounts source, `pnpm dev`):

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

**Run checks:**

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
```

## License

MIT
