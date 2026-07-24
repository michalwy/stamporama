-- Backfill sortOrder (#78) so existing areas keep their current alphabetical order as the
-- initial custom order. Number each area among its siblings (same collection + parent) by
-- name, starting at 0. Grouping the NULL parent via COALESCE keeps top-level areas in one
-- sibling group. Idempotent enough to re-run: it just recomputes the same ordering.
UPDATE "collection_area" AS ca
SET "sortOrder" = ranked.rn
FROM (
  SELECT
    "id",
    (ROW_NUMBER() OVER (
      PARTITION BY "collectionId", COALESCE("parentId", '')
      ORDER BY "name" ASC, "id" ASC
    ) - 1) AS rn
  FROM "collection_area"
) AS ranked
WHERE ca."id" = ranked."id";
