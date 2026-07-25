-- Explicit ordering for offer sets and the copies inside them (#306). Until now `offer_set` had no
-- ordering column and queries fell back to `id ASC` (cuid, i.e. incidental creation order), while
-- `offer_set_item` had no ordering at all. Set order is what a buyer reads as "the second lot" and
-- what the offer photo plan (#309) renders as image groups, so it becomes canonical and persisted.

-- Set position within its offer: non-null, 0-based, dense. Existing rows are backfilled in creation
-- order (cuid ASC), which is exactly the order the old `id ASC` fallback produced — no visible change.
ALTER TABLE "offer_set" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "offer_set" AS s
SET "sortOrder" = r.rn
FROM (
  SELECT id, (row_number() OVER (PARTITION BY "offerId" ORDER BY id)) - 1 AS rn
  FROM "offer_set"
) AS r
WHERE s.id = r.id;

-- Copy position inside its set. NULL on purpose: it means "derive from the catalog sort key"
-- (`stamp."primaryCatalogSortKey"`, ADR-0014); a value means the collector hand-corrected the order.
-- Every existing row stays NULL, so existing sets simply start showing in catalog order.
ALTER TABLE "offer_set_item" ADD COLUMN "sortOrder" INTEGER;
