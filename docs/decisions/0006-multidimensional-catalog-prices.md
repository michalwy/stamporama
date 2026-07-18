# ADR-0006: Multi-dimensional catalog prices

## Status

Accepted

## Context

Catalogs quote different prices for the same stamp+edition depending on the
stamp's physical **condition** (MNH, MH, U, CTO, …) and its **certificate /
guarantee status** (none, certificate, guarantee, …). The original
`StampCatalogPrice` model stored a single price per `(stampId, catalogEditionId)`
pair, which could not represent this and produced misleading data.

See GitHub issues #91 (schema), #92 (price-entry UI), #93 (condition management),
#94 (certificate status management), #95 (list price column).

## Decisions

### 1. Two independent, user-defined dimensions

Condition and certificate status are separate per-collection lists
(`StampCondition`, `CertificateStatus`), not a single flattened list.
Modelling certificates as condition variants (e.g. "MNH+certificate") was
rejected: it causes combinatorial duplication of condition names and prevents
querying/filtering by condition independently of certificate status.

### 2. Certificate status is optional; condition is required

A catalog price is always for a specific condition (`conditionId` NOT NULL).
Certificate status is optional (`certificateStatusId` nullable): the absence of
a selection **means "none"**, so collections carry no seeded "None" row. Both
FKs use `onDelete: Restrict` — a condition or status referenced by any price
cannot be deleted (surfaced as a friendly error before the DB constraint fires).

### 3. Surrogate key + `NULLS NOT DISTINCT` uniqueness → PostgreSQL 15 floor

`StampCatalogPrice` uses a surrogate `id` primary key. Logical uniqueness is
`(stampId, catalogEditionId, conditionId, certificateStatusId)`. Because
`certificateStatusId` is nullable and, by default, Postgres treats NULLs as
distinct in unique indexes, two "no-certificate" prices for the same
stamp+edition+condition would both be allowed. To forbid that with a single
index we use `CREATE UNIQUE INDEX ... NULLS NOT DISTINCT`, which treats NULL as
a single value.

`NULLS NOT DISTINCT` requires **PostgreSQL 15+**. The project already ships
`postgres:16-alpine`, so this sets a documented **minimum version of 15**. The
alternative (two partial unique indexes, one `WHERE certificateStatusId IS NULL`
and one `WHERE ... IS NOT NULL`) works on older Postgres but adds moving parts
for no benefit here. Prisma cannot express `NULLS NOT DISTINCT`, so the index is
defined in the migration SQL only and omitted from `schema.prisma`.

### 4. Migration drops existing price rows

Existing prices had no condition to map onto, and the data was non-production, so
the migration drops and recreates `stamp_catalog_price` rather than backfilling.
Collections that lacked conditions get the default set seeded on demand (demo
seeder; otherwise conditions are seeded at collection creation).

### 5. List price column: client-side condition switcher, no persisted default

A stamp now has many prices, so list views (issue list, flat stamp list) show the
price for **one** condition, chosen by a **switcher above the list** with
certificate status = none. The choice is persisted in **localStorage per
collection** (not a server-side collection setting — a deliberate simplification
of #95); the default is the first condition by `sortOrder`, matching the server
fallback in `resolveDisplayConditionId`. A per-row **⋯** button opens a popover
listing every recorded price for that stamp, fetched lazily so list payloads stay
lean.

## Schema

```prisma
model StampCatalogPrice {
  id                  String  @id @default(cuid())
  stampId             String
  catalogEditionId    String
  conditionId         String
  certificateStatusId String?
  price               Decimal @db.Decimal(10, 2)
  currency            String

  stamp             Stamp              @relation(fields: [stampId], references: [id], onDelete: Cascade)
  catalogEdition    CatalogEdition     @relation(fields: [catalogEditionId], references: [id], onDelete: Cascade)
  condition         StampCondition     @relation(fields: [conditionId], references: [id], onDelete: Restrict)
  certificateStatus CertificateStatus? @relation(fields: [certificateStatusId], references: [id], onDelete: Restrict)

  @@index([stampId])
  @@index([catalogEditionId])
  @@index([conditionId])
  @@index([certificateStatusId])
  @@map("stamp_catalog_price")
}
```

```sql
-- migration-only; not expressible in schema.prisma
CREATE UNIQUE INDEX "stamp_catalog_price_unique"
  ON "stamp_catalog_price" ("stampId", "catalogEditionId", "conditionId", "certificateStatusId")
  NULLS NOT DISTINCT;
```

## Consequences

- **Minimum PostgreSQL version is 15.** Documented in `docs/architecture/overview.md`
  and README; self-hosters on the provided compose files (Postgres 16) are unaffected.
- Prisma's client believes NULL certificate values are distinct (it cannot see
  `NULLS NOT DISTINCT`); code must not rely on upserting no-certificate rows via a
  compound unique. The write path rebuilds a stamp's prices (delete-all + createMany)
  rather than upserting, so this is a non-issue.
- Price entry moves from one input per edition to a condition×certificate grid per
  edition (#92). The list price column depends on a client-selected condition (#95).
- Deleting a condition or certificate status that is in use is blocked at both the
  application layer and the database (`Restrict`).
