-- Custom sibling display order for collection areas (#78). Lower sorts first; ties break
-- by name. New areas are appended (max sibling sortOrder + 1) in the domain layer. Default
-- 0 for now; the next migration backfills a stable per-sibling order from the current
-- alphabetical arrangement so existing trees don't visibly reshuffle.
ALTER TABLE "collection_area" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
