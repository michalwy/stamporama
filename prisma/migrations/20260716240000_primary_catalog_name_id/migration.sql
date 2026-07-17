ALTER TABLE "collection_area_catalog" DROP COLUMN IF EXISTS "isDefault";
ALTER TABLE "collection_area" ADD COLUMN IF NOT EXISTS "primaryCatalogNameId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'collection_area_primaryCatalogNameId_fkey'
      AND table_name = 'collection_area'
  ) THEN
    ALTER TABLE "collection_area" ADD CONSTRAINT "collection_area_primaryCatalogNameId_fkey"
      FOREIGN KEY ("primaryCatalogNameId") REFERENCES "catalog_name"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
