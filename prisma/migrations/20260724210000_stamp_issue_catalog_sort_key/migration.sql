-- Denormalized numeric sort key for catalog-number ordering (#181). Stored on `issue` and `stamp`
-- so every list sort can break ties by primary catalog number with an indexed ORDER BY + LIMIT,
-- instead of loading every matching row into app memory to sort. Nullable: NULL means the row has
-- no numeric catalog number and always sorts last. Backfilled by the next migration; maintained at
-- runtime by the recompute helpers in src/lib/catalog-sort-key.ts. See ADR-0014.

ALTER TABLE "issue" ADD COLUMN "primaryCatalogSortKey" INTEGER;
ALTER TABLE "stamp" ADD COLUMN "primaryCatalogSortKey" INTEGER;

CREATE INDEX "issue_collectionId_year_primaryCatalogSortKey_idx"
  ON "issue" ("collectionId", "year", "primaryCatalogSortKey");
CREATE INDEX "issue_collectionId_primaryCatalogSortKey_idx"
  ON "issue" ("collectionId", "primaryCatalogSortKey");

CREATE INDEX "stamp_collectionId_issuedYear_primaryCatalogSortKey_idx"
  ON "stamp" ("collectionId", "issuedYear", "primaryCatalogSortKey");
CREATE INDEX "stamp_collectionId_primaryCatalogSortKey_idx"
  ON "stamp" ("collectionId", "primaryCatalogSortKey");
