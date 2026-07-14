# Stamporama

A self-hosted web application for stamp collectors.

Stamporama helps you manage your stamp collection, track trades and purchases, hunt for new stamps, and keep everything in one place.

## Features (planned)

- **Catalog** — stamps you own, by catalog number, series, topic, and country
- **Collection** — condition, acquisition details, duplicates for trade or sale
- **Trading** — agree on scope, track progress with other collectors
- **Purchases & Sales** — what you bought and sold, prices, profit/loss
- **Stamp hunting** — want list, auction tracking, price history
- **Integrations** — Collnect, Delcampe

## Self-hosting

Install Docker, then run:

```sh
curl -fsSL https://raw.githubusercontent.com/michalwy/stamporama/main/scripts/install.sh | bash
```

The installer downloads the compose files, walks you through environment configuration, and starts the stack. Stamporama will be available on port 3000.

To manage the running stack:

```sh
cd ~/stamporama
docker compose ps
docker compose pull && docker compose up -d   # update to latest release
docker compose down                            # stop
```

Optional auto-update via [Watchtower](https://containrrr.dev/watchtower/):

```sh
docker compose --profile autoupdate up -d
```

## Development

Prerequisites: Docker, Node.js 22+, pnpm.

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
