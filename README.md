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

Uploaded photos — and the listing images generated for offers — are stored in the `stamporama-data` Docker volume (mounted at `/data`) by default. Back it up alongside your database — losing the volume loses the images.

Alternatively, photos can be stored in **Google Cloud Storage** — the installer asks for the bucket and service-account key and sets it up for you (or configure it by hand via the GCS section of `.env.prod.example`). Photos are served via short-lived signed URLs so bytes bypass the app. Switching is safe at any time — existing filesystem photos keep serving from the volume while new photos write to GCS, and the optional `pnpm photos:migrate:gcs` command moves old photos across so the volume can be retired.

There is also the **Stamporama Assistant**, a Chrome extension that matches Colnect catalog pages against your collection while you browse. It installs from an unlisted Chrome Web Store listing in one click and updates itself from there — see the [user guide](docs/user-guide/assistant.md).

If you sell on **Allegro**, the instance can also talk to Allegro's own API using an application you
register yourself — see [Allegro](docs/user-guide/allegro.md): it keeps a worklist of what has sold
and is still to be written down, and marks your auctions as in active bidding within minutes of the
first bid. It needs one extra environment variable, `STAMPORAMA_SECRET_KEY`, which encrypts the
stored credentials at rest.

## Development

Prerequisites: Docker, Node.js 22+, pnpm. Self-hosting against an external database requires **PostgreSQL 15+** (the bundled containers use Postgres 18).

> **Upgrading a local stack created before Postgres 18?** The dev `db_data` volume holds a
> Postgres 16 cluster that Postgres 18 cannot read, and the 18+ images moved the data directory
> to `/var/lib/postgresql/<major>/docker`. Dump before switching, then restore into a fresh
> volume — see [Upgrading the local Postgres major version](docs/development/postgres-upgrade.md).
> Production is unaffected: it uses an external database, not this container.

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
