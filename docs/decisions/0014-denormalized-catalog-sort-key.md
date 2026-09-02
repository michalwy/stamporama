# ADR-0014: Denormalized Catalog Sort Key

## Status

Accepted

## Context

Every sortable list of issues and stamps must apply the **primary catalog number** as an
implicit secondary (tiebreaker) sort key, so items sharing a primary sort value (e.g. the
same year) still read in catalog-number order rather than an arbitrary one (#181).

The catalog number to sort by is a derived value:

- Catalog numbers are strings (`"200"`, `"200a"`, `"Bl3"`), and the ordering is the
  **catalogue's own**: numeric within a numbering family, and a family at a time — a catalog
  numbers its Porto, block and Dienst issues in sequences of their own, written with a letter
  prefix. A number carrying no digits at all sorts last.
- The number that counts is the one belonging to the area's **effective primary-catalog
  vendor** — which is itself inherited by climbing the collecting-area tree to the nearest
  ancestor that names a leading vendor (`buildPrimaryVendorByAreaMap`; the *vendor*, not the
  price book, since ADR-0040 split the two). When the row has no number for that vendor, we
  fall back to the lowest key across its numbers.

Prisma's `orderBy` cannot express this: it cannot order by a parsed string, and
it cannot order by a field reached through a to-many relation (`IssueCatalogNumber` /
`StampCatalogNumber`). The first implementation therefore sorted **in application memory**:
it loaded the id + sort keys of *every* matching row on every page, sorted in Node, then
fetched the page. That is correct but scales poorly — it holds the whole filtered result set
in memory and re-sorts it on every infinite-scroll page, turning an indexed `LIMIT/OFFSET`
into an O(N)-per-page load.

## Decision

Denormalize the derived sort value into an indexed **text** column, `primaryCatalogSortKey`,
on both `issue` and `stamp` (nullable; `NULL` means "no number to sort by" and sorts last via
`NULLS LAST`). Reads become an ordinary indexed
`ORDER BY … , "primaryCatalogSortKey" … LIMIT/OFFSET`. Composite indexes
`(collectionId, year, primaryCatalogSortKey)` / `(collectionId, issuedYear,
primaryCatalogSortKey)` and `(collectionId, primaryCatalogSortKey)` back the common sorts.

The only sort that remains in-memory is the stamp list's **issue-name** sort, because the
issue name lives across the to-many `issueMemberships` relation; even there the stored key
supplies the tiebreaker, so no catalog number is re-parsed.

### The encoding

One number's key is `<prefix><10-digit zero-padded number><suffix>`, lowercase: the letters
that **lead** the number (its numbering family), its first digit run padded so a family's
numbers compare numerically as text, and the letters written straight after that run (its
variant suffix). `"200"` → `0000000200`, `"200a"` → `0000000200a`, `"P15"` → `p0000000015`,
`"Bl 3"` → `bl0000000003`. A number with no digit run at all (a bare Roman numeral) has no
key and sorts last.

ASCII puts digits before letters, so the basic numbering sorts first and each prefix follows
as its own block, alphabetically — the catalogue's own arrangement. The column is
`text COLLATE "C"` so Postgres orders the keys byte by byte, the same order JS `<` gives:
the same key is compared in the database (list `ORDER BY`s) and in memory (the comparators
that fall back to catalog order), and one of them ordering by a locale's rules instead would
make two screens disagree about the same series.

It was an `INTEGER` of the leading digits until the prefixed families showed what that cost:
parsing only what a number *starts* with sent every one of them — Michel `P`, `Bl`, `D`,
`W`/`S`/`Zd` — into the number-less bucket at the end of every list, ordered by name, where
`P15` read before `P1—14`. A second column (the family beside the number) was weighed and
rejected: the key is threaded through a dozen `ORDER BY`s, selects and comparators, and two
columns is two chances to order by half the key.

### The formula (single definition, two implementations)

`primaryCatalogSortKey` = the key of the effective primary-catalog vendor's number; else the
lowest key across all the row's numbers; else `NULL`.

It exists twice, deliberately, and the two must stay in sync:

1. **Runtime (TypeScript):** `computeCatalogSortKey` in `src/lib/catalog-sort-key.ts`
   (pure, unit-tested), driven by `src/lib/catalog-sort-key-recompute.ts`.
2. **Backfill (SQL):** the recursive-CTE `UPDATE` in
   `prisma/migrations/*_catalog_sort_key_prefix_aware`, which resolves the effective primary
   vendor by climbing the area tree — on `primaryCatalogVendorId`, the leading **vendor**
   (ADR-0040), where the frozen first backfill still reads the price book — and encodes each
   number with `regexp_match(… '^\s*([A-Za-z]*)\s*([0-9]+)([A-Za-z]*)')`.

A backfill migration is frozen once written; the TypeScript copy is the living source of
truth. Any change to the formula updates the TypeScript and adds a **new** backfill migration —
never edits an existing one.

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
- **The key is text, so every comparison goes through one helper.** In-memory orderings call
  `compareCatalogSortKeys` (ascending, `null` last) rather than subtracting, which is what a
  numeric key invited; SQL keeps `ASC NULLS LAST`, unchanged.

## Alternatives considered

- **A second column for the numbering family**, kept beside the integer. Rejected above: the
  key reaches a dozen call sites, and a two-part key ordered by one part is a silent wrong
  order.
- **Raw SQL at read time** (recursive CTE + numeric cast + join, per query). Keeps the value
  underived, but the ordering expression is not indexable, so Postgres still sorts every
  matching row per page — it moves the O(N)-per-page sort from Node into the database rather
  than removing it, and adds a complex query to every list read.
- **Status quo (in-memory sort).** Correct but O(N) memory and re-sort per page; the problem
  this ADR solves.
