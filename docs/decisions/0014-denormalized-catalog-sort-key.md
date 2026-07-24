# ADR-0014: Denormalized Catalog Sort Key

## Status

Accepted

## Context

Every sortable list of issues and stamps must apply the **primary catalog number** as an
implicit secondary (tiebreaker) sort key, so items sharing a primary sort value (e.g. the
same year) still read in catalog-number order rather than an arbitrary one (#181).

The catalog number to sort by is a derived value:

- Catalog numbers are strings (`"200"`, `"200a"`, `"Bl3"`), but the ordering is **numeric**
  (leading digits parsed to an integer; a non-numeric number sorts last).
- The number that counts is the one belonging to the area's **effective primary-catalog
  vendor** — which is itself inherited by climbing the collecting-area tree to the nearest
  ancestor that sets a primary catalog (`buildEffectivePrimaryCatalogMap`). When the row has
  no number for that vendor, we fall back to the lowest numeric across its numbers.

Prisma's `orderBy` cannot express this: it cannot order by a numerically-parsed string, and
it cannot order by a field reached through a to-many relation (`IssueCatalogNumber` /
`StampCatalogNumber`). The first implementation therefore sorted **in application memory**:
it loaded the id + sort keys of *every* matching row on every page, sorted in Node, then
fetched the page. That is correct but scales poorly — it holds the whole filtered result set
in memory and re-sorts it on every infinite-scroll page, turning an indexed `LIMIT/OFFSET`
into an O(N)-per-page load.

## Decision

Denormalize the derived sort value into an indexed integer column,
`primaryCatalogSortKey`, on both `issue` and `stamp` (nullable; `NULL` means "no numeric
catalog number" and sorts last via `NULLS LAST`). Reads become an ordinary indexed
`ORDER BY … , "primaryCatalogSortKey" … LIMIT/OFFSET`. Composite indexes
`(collectionId, year, primaryCatalogSortKey)` / `(collectionId, issuedYear,
primaryCatalogSortKey)` and `(collectionId, primaryCatalogSortKey)` back the common sorts.

The only sort that remains in-memory is the stamp list's **issue-name** sort, because the
issue name lives across the to-many `issueMemberships` relation; even there the stored key
supplies the tiebreaker, so no catalog number is re-parsed.

### The formula (single definition, two implementations)

`primaryCatalogSortKey` = the parsed leading-digits integer of the effective
primary-catalog vendor's number; else the lowest numeric across all the row's numbers;
else `NULL`.

It exists twice, deliberately, and the two must stay in sync:

1. **Runtime (TypeScript):** `computeCatalogSortKey` in `src/lib/catalog-sort-key.ts`
   (pure, unit-tested), driven by `src/lib/catalog-sort-key-recompute.ts`.
2. **Backfill (SQL):** the recursive-CTE `UPDATE` in
   `prisma/migrations/*_backfill_catalog_sort_key`, which resolves the effective primary
   vendor by climbing the area tree and parses `substring(number from '^[0-9]+')`.

The SQL copy is a frozen, one-time backfill; the TypeScript copy is the living source of
truth. Any change to the formula updates the TypeScript and adds a new backfill migration —
never edits the frozen one.

### Maintenance (when the key is recomputed)

The key is a function of (the row's catalog numbers) **and** (its area's effective primary
vendor). It is recomputed, scoped to the affected rows, on every write that can change
either input:

| Trigger | Scope | Frequency |
| --- | --- | --- |
| Stamp catalog numbers change (`updateStampWithCatalog`, upsert/delete number) | the stamp | common |
| Issue catalog numbers change (create, update, `setIssueCatalogRange`) | the issue | common |
| Stamps auto-generated for an issue (create-with-range, add-stamp-range, add stamp) | those stamps | common |
| Issue moved to another area (`moveIssueToArea`, re-tags its stamps) | the issue + its stamps | rare |
| An area's effective primary catalog changes — its own primary catalog set/cleared, or the area reparented (`updateCollectionArea`) | the whole area subtree's issues + stamps | very rare |
| Demo data seeded/reset | the whole collection | rare |

`moveStampNode` (moving a stamp between issues) does **not** recompute: it leaves the
stamp's own area link untouched, so its effective primary vendor is unchanged.

Recompute runs **post-commit** with the plain Prisma client, not inside the caller's
transaction. This keeps callers free of transaction-client threading; the cost is a
sub-second window where a key is briefly stale, which is acceptable for a single-user,
self-hosted app and is closed by the next read. Bulk writes use a single
`UPDATE … FROM (VALUES …)` per chunk.

## Consequences

- **Reads are indexed again.** No result set is loaded into app memory to sort (except the
  stamp issue-name sort, which was already in-memory before #181). Pagination touches ~one
  page of rows.
- **A denormalized column must be maintained.** The risk is a missed write path leaving a
  stale key and a silently wrong order. Mitigations: the write paths that touch catalog
  numbers or area assignment are few and centralized; area-level changes recompute the whole
  affected subtree; `recompute*SortKeys(collectionId)` with no id list recomputes an entire
  collection as a repair/backfill primitive; and integration tests assert the key across the
  create / primary-vs-fallback / range-set / area-primary-change paths.
- **Two copies of the formula.** Accepted for the readability of TypeScript at runtime plus a
  self-contained SQL backfill; kept aligned by this ADR and by the tests.

## Alternatives considered

- **Raw SQL at read time** (recursive CTE + numeric cast + join, per query). Keeps the value
  underived, but the ordering expression is not indexable, so Postgres still sorts every
  matching row per page — it moves the O(N)-per-page sort from Node into the database rather
  than removing it, and adds a complex query to every list read.
- **Status quo (in-memory sort).** Correct but O(N) memory and re-sort per page; the problem
  this ADR solves.
