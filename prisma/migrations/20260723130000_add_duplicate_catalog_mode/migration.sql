-- Per-collection duplicate catalog-number policy (#85). "warn" (default) shows a
-- non-blocking warning when a stamp's catalog identity already exists; "block"
-- prevents the save. Existing collections default to the permissive "warn".
ALTER TABLE "collection" ADD COLUMN "duplicateCatalogMode" TEXT NOT NULL DEFAULT 'warn';
