-- Remove redundant abbreviation field from catalog_name.
-- Catalog number formatting uses CatalogVendor.abbreviation exclusively (since #66).
ALTER TABLE "catalog_name" DROP COLUMN IF EXISTS "abbreviation";
