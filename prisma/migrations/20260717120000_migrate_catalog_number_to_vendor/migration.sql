-- Create collection_area_vendor table
CREATE TABLE "collection_area_vendor" (
  "collectionAreaId" TEXT NOT NULL,
  "catalogVendorId"  TEXT NOT NULL,
  "areaPrefix"       TEXT,
  CONSTRAINT "collection_area_vendor_pkey" PRIMARY KEY ("collectionAreaId", "catalogVendorId")
);

ALTER TABLE "collection_area_vendor"
  ADD CONSTRAINT "collection_area_vendor_collectionAreaId_fkey"
    FOREIGN KEY ("collectionAreaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_area_vendor"
  ADD CONSTRAINT "collection_area_vendor_catalogVendorId_fkey"
    FOREIGN KEY ("catalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate prefix data from collection_area_catalog to collection_area_vendor
INSERT INTO "collection_area_vendor" ("collectionAreaId", "catalogVendorId", "areaPrefix")
SELECT cac."collectionAreaId", cn."vendorId", MAX(cac."prefix")
FROM "collection_area_catalog" cac
JOIN "catalog_name" cn ON cn."id" = cac."catalogNameId"
WHERE cac."prefix" IS NOT NULL
GROUP BY cac."collectionAreaId", cn."vendorId";

-- Drop prefix column from collection_area_catalog
ALTER TABLE "collection_area_catalog" DROP COLUMN "prefix";

-- Migrate stamp_catalog_number from catalogNameId to catalogVendorId
ALTER TABLE "stamp_catalog_number" ADD COLUMN "catalogVendorId" TEXT;

UPDATE "stamp_catalog_number" scn
SET "catalogVendorId" = cn."vendorId"
FROM "catalog_name" cn
WHERE cn."id" = scn."catalogNameId";

-- Deduplicate: if multiple catalog names per vendor had entries for the same stamp, keep one
DELETE FROM "stamp_catalog_number"
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM "stamp_catalog_number"
  GROUP BY "stampId", "catalogVendorId"
);

ALTER TABLE "stamp_catalog_number" ALTER COLUMN "catalogVendorId" SET NOT NULL;
ALTER TABLE "stamp_catalog_number" DROP CONSTRAINT "stamp_catalog_number_pkey";
ALTER TABLE "stamp_catalog_number" DROP COLUMN "catalogNameId";
ALTER TABLE "stamp_catalog_number"
  ADD CONSTRAINT "stamp_catalog_number_pkey" PRIMARY KEY ("stampId", "catalogVendorId");
ALTER TABLE "stamp_catalog_number"
  ADD CONSTRAINT "stamp_catalog_number_catalogVendorId_fkey"
    FOREIGN KEY ("catalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
