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

Production does not run a database container. The operator provides an external PostgreSQL via `DATABASE_URL`. **PostgreSQL 15 or newer is required** — migrations use `NULLS NOT DISTINCT` unique indexes (see [ADR-0006](../decisions/0006-multidimensional-catalog-prices.md)). The bundled dev/e2e containers run Postgres 16.

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
| Docker Compose (any stack) | `prisma migrate deploy` | Runs automatically on container start before `pnpm start`/`pnpm dev` |
| Integration tests | `pnpm exec prisma migrate deploy` | Applied automatically by `pnpm test:integration` |
| CI (integration job) | `pnpm exec prisma migrate deploy` | Runs against a fresh service-container DB |
| Production | Handled automatically on container start | `docker-compose.prod.yml` runs migrate deploy before `pnpm start` |

**Schema:** `prisma/schema.prisma` — PostgreSQL datasource, client output at `src/generated/prisma`.

**Config:** `prisma.config.ts` — loads `DATABASE_URL` from the environment (via dotenv), sets schema and migrations paths.

**Client singleton:** `src/lib/db.ts` — exports `prisma`, a `PrismaClient` instance initialized with the `PrismaPg` adapter. Uses `globalThis` caching to avoid exhausting connections during Next.js hot-reload.

## Domain Model

### Collection

The `Collection` model is the top-level organizing unit. All stamp data belongs to a collection. A user can own multiple collections; each collection belongs to exactly one user.

**Prisma model** (`prisma/schema.prisma`):

```prisma
model Collection {
  id        String   @id @default(cuid())
  slug      String
  name      String
  ownerId   String
  createdAt DateTime @default(now())
  owner     User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@unique([ownerId, slug])
  @@map("collection")
}
```

**Key design decisions:**
- `@@unique([ownerId, slug])` enforces slug uniqueness per user at the database level and serves as the index for fast slug lookups.
- Slugs are auto-generated from the collection name (lowercase, hyphens); collisions within a user's collections get a numeric suffix (`-2`, `-3`, …).
- Authorization uses `getCollectionBySlug(ownerId, slug)` — a lookup by the compound unique key. A slug that belongs to a different user returns `null`, producing a 404 rather than a 403 to avoid leaking slug existence.

**Domain layer:** `src/lib/collections.ts` — `createCollection`, `getCollectionsByOwner`, `getCollectionBySlug`. Imports `"server-only"` to prevent accidental bundling into client code. Pure slug utilities live separately in `src/lib/slug.ts` (no `"server-only"`, unit-testable).

**Collection routes:** `/c/[collectionSlug]/` — the layout validates the slug and authorizes the session user as owner before rendering.

**Dialog primitive:** All modal dialogs use the shared shell at `src/app/dialog-shell.tsx`. It provides: backdrop, header with close button, scrollable body, optional fixed footer.

### Physical holdings (`Item`)

`Item` represents a collector's physical copies. Per ADR-0007, there is **one row per physical copy** — no quantity field — because copies of the same stamp and condition can differ (e.g. postmark type) in ways that affect value and intent.

- `stampId` → `Stamp` at any level of the variant tree: a base stamp (`parentId = null`) means the variant is unknown; a variant row means the copy is identified. The tree level implicitly encodes variant certainty; there is no "unknown" flag.
- `conditionId` → `StampCondition` and `certificateStatusId?` → `CertificateStatus` reference the per-collection configurable sets (Issues #93/#94), mirroring `StampCatalogPrice`.
- Disposition is three **independent booleans** — `inCollection`, `forSale`, `forTrade` — not a mutually-exclusive status. A copy can hold any combination.
- Acquisition & cost (ADR-0009, #118): a copy links to its acquisition via `lotId?` → `PurchaseLot` (`onDelete: Restrict`) — one channel among several, so nullable. Supplier, date, and price live on `Purchase`/`PurchaseLot`, not on `Item`; the flat fields from ADR-0007 (`contactId`, `acquiredDate`, `purchasePrice`, `purchaseCurrency`) were removed. `costBasis?` `Decimal(10,2)` is a base-currency snapshot (null = pending). `deliveryState` (`in_transit | delivered | not_delivered | damaged`, default `delivered`) is an independent physical-delivery axis. `notes` holds free-form per-copy detail. **No copy-level UI captures purchase data yet** — the purchase CRUD/intake screens land in #120+.
- Physical storage (#56): `locationId?` → `Location` (an assignable storage node) records where the copy is filed; `locationRef?` is a free-text identifier within that location (e.g. a page/pocket like `p.12`), per copy and **not unique**. Only `assignable = true` locations are valid targets, enforced server-side.
- `ItemVariantHistory` records in-place re-pointing of `stampId` when an unknown-variant copy is later identified (`fromStampId`, `toStampId`, `changedAt`, `note?`), giving a refinement trail without versioning the whole `Item`.

Referential actions: `collectionId` and `stampId` cascade; `conditionId`, `certificateStatusId`, `lotId`, and `locationId` restrict (mirrors `StampCatalogPrice`). Indexed on `collectionId`, `stampId`, `conditionId`, `lotId`, `locationId`.

Valuation of an unknown-variant copy (lowest child-variant catalog price, flagged uncertain) is shared domain logic and belongs out of UI components; it lands with a later child issue.

### Contacts (`Contact`)

`Contact` is a per-collection address book of everyone the collector deals with — sellers, buyers, exchange partners, auction houses, platforms (see [ADR-0008](../decisions/0008-contact-entity.md)). It is the supplier reference for purchases (ADR-0009) and the foundation for the future sales/trade layer.

- `name` is **unique per collection**; `notes`, `email`, `phone` are optional.
- Roles are six **independent booleans** — `buyer`, `seller`, `exchangePartner`, `auctionHouse`, `platform`, `other` — not an enum. A contact can hold several at once, mirroring the `Item` disposition flags.
- A contact may be created with **no roles set** (roles are filled in later).
- `collectionId` cascades. Foreign keys pointing *at* a contact (from `Purchase`, and future sales lots) use `onDelete: Restrict` so a referenced contact cannot be deleted without first detaching it.
- Domain module `src/lib/contacts.ts` (server-only) exposes `listContacts` / `searchContacts` / `createContact`, all collection-owner-authorized.

### Purchases (`Purchase` / `PurchaseLot` / `PurchaseExpense`)

The purchase model (see [ADR-0009](../decisions/0009-purchase-record-model.md), schema in #118) is the channel-agnostic source of cost-basis. **Schema only so far** — no UI or domain logic yet (allocation is #119, CRUD/intake are #120+).

- `Purchase` — transaction header: optional `contactId?` → `Contact` supplier (`onDelete: Restrict`), `purchasedAt` (date), a single `currency`, `fxRateToBase?` frozen at `purchasedAt` (`Decimal(65,30)`, reuses the `ExchangeRate` mechanism), `shippingCost?` `Decimal(10,2)` (shared cost), and a delivery `status` (`preparing | in_transit | arrived`). Scoped to `Collection` (`onDelete: Cascade`).
- `PurchaseLot` — inventory line: `price` `Decimal(10,2)`, intake `status` (`open | closed`), and the `Item`s it resolves into. `onDelete: Cascade` from `Purchase`.
- `PurchaseExpense` — non-inventory line (e.g. a magnifier): `label` + `price` `Decimal(10,2)`, no lifecycle and no items. `onDelete: Cascade` from `Purchase`.
- Statuses are `String` columns (the schema uses no native Postgres enums), with allowed values documented in the schema and enforced by the domain layer.

### Storage locations (`Location`)

`Location` is a per-collection **adjacency-list hierarchy** of physical storage — cabinets, stockbooks, albums, boxes — reusing the same pattern as `CollectionArea` (see [ADR-0010](../decisions/0010-storage-location-model.md), design in #55, built in #56).

- Fields: `id`, `collectionId`, `name`, `parentId?` (arbitrary depth), `description?`, `assignable` (`Boolean`, default `true`), `createdAt`.
- `assignable` distinguishes grouping-only nodes (a cabinet — `false`) from leaf storage that can actually hold copies (a stockbook — `true`). A copy's `locationId` may only point at an `assignable = true` location.
- `collectionId` cascades; the self `parentId` FK is `SetNull` (matching `CollectionArea`), but deleting a location that still has children or stored copies is blocked in the domain layer. The `Item.locationId` FK is `onDelete: Restrict` so a stored copy is never orphaned.
- Filtering the inventory by a location includes the whole **subtree** (a parent selection shows copies in its descendants), resolved server-side in `src/lib/items.ts`.
- Domain module `src/lib/locations.ts` (server-only) exposes `getLocations` / `createLocation` / `updateLocation` / `deleteLocation`, all collection-owner-authorized, with the cycle, assignable, and delete guards.

## CI

The `ci.yml` GitHub Actions workflow runs three jobs on every push and pull request:

- **static-checks** — lint, typecheck, build (generates Prisma client first)
- **unit** — unit tests (generates Prisma client first)
- **integration** — spins up a PostgreSQL 16 service container, applies migrations via `prisma migrate deploy`, then runs `tests/integration/`

The **publish-image** job triggers only on `v*` tags and requires all three jobs to pass. It pushes a multi-arch image (`linux/amd64`, `linux/arm64`) to `ghcr.io/michalwy/stamporama`.

## Authentication

Stamporama uses [Better Auth](https://better-auth.com/) with the email/password provider.

**Server instance:** `src/lib/auth.ts` — initializes Better Auth with the Prisma adapter (sharing the `prisma` singleton from `src/lib/db.ts`) and the email/password provider.

**Client instance:** `src/lib/auth-client.ts` — `createAuthClient()` for use in client components. Defaults to the same origin (`/api/auth/*`); no explicit `baseURL` required.

**API handler:** `src/app/api/auth/[...all]/route.ts` — catches all Better Auth API requests (`GET` + `POST`) via `toNextJsHandler(auth)`.

**Middleware:** `src/middleware.ts` — protects `/c/*` (collection routes) and `/collections` (collection picker). Runs on the Next.js Edge runtime; calls `/api/auth/get-session` via native `fetch` to avoid importing Node.js-only modules in Edge context. Unauthenticated requests are redirected to `/sign-in`.

**Prisma schema:** Better Auth manages four tables — `user`, `session`, `account`, `verification` — added in migration `20260714190000_add_better_auth_schema`.

**Session check in Server Components:** call `auth.api.getSession({ headers: await headers() })` directly (Node.js runtime, safe outside middleware).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | Random secret for auth session signing (generate with `openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | yes | Public base URL of the app (e.g. `http://localhost:3000`) |
| `POSTGRES_PASSWORD` | yes (db) | Password for the `stamporama` database user |
| `TAG` | prod only | Image tag to pull (default: `latest`) |
| `STAMPORAMA_VERSION` | build-time | Baked into the image; set by CI from the git tag |
