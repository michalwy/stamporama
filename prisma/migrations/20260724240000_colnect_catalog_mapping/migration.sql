-- Per-collection Colnect catalog abbreviation -> local CatalogVendor mapping (#248, part of #155).
-- Only mismatches need a row (e.g. Colnect "Pol" -> our Fischer "Fi"); abbreviations without a row
-- fall back in application code to a vendor whose abbreviation matches exactly, else are ignored.
CREATE TABLE "colnect_catalog_mapping" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "colnectAbbrev" TEXT NOT NULL,
    "catalogVendorId" TEXT NOT NULL,

    CONSTRAINT "colnect_catalog_mapping_pkey" PRIMARY KEY ("id")
);

-- One mapping per Colnect abbreviation per collection.
CREATE UNIQUE INDEX "colnect_catalog_mapping_collectionId_colnectAbbrev_key"
    ON "colnect_catalog_mapping"("collectionId", "colnectAbbrev");

CREATE INDEX "colnect_catalog_mapping_collectionId_idx"
    ON "colnect_catalog_mapping"("collectionId");

CREATE INDEX "colnect_catalog_mapping_catalogVendorId_idx"
    ON "colnect_catalog_mapping"("catalogVendorId");

ALTER TABLE "colnect_catalog_mapping"
    ADD CONSTRAINT "colnect_catalog_mapping_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "colnect_catalog_mapping"
    ADD CONSTRAINT "colnect_catalog_mapping_catalogVendorId_fkey"
    FOREIGN KEY ("catalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
