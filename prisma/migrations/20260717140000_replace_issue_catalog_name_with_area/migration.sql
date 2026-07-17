-- Replace Issue.catalogNameId with collectionAreaId, and add year field.
-- The catalog is now derived from the area's primaryCatalogNameId, making the
-- per-issue catalogNameId redundant. Closes part of #54.
-- Note: Prisma uses camelCase column names by default; existing columns
-- in the issue table follow that convention (collectionId, catalogNameId, etc.).
ALTER TABLE "issue"
  DROP COLUMN IF EXISTS "catalogNameId",
  ADD COLUMN "collectionAreaId" TEXT NOT NULL REFERENCES "collection_area"("id") ON DELETE CASCADE,
  ADD COLUMN "year" INTEGER;
