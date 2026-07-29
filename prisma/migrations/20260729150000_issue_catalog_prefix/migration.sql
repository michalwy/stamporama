-- Per-issue override of the area-resolved catalog prefix (#377).
--
-- A stamp's catalog identity is `vendor + effective area prefix + number` (#66/#85). The prefix is
-- normally set on `collection_area_vendor` and inherited down the area tree, but some issues
-- legitimately number under a different prefix than the area they sit in — a special or
-- commemorative sub-catalog. A row here replaces the inherited prefix for one issue and one vendor,
-- everywhere: the displayed label, duplicate detection (#85) and the Colnect strict full-key match
-- (#155).
--
-- `areaPrefix` is NOT NULL, unlike `collection_area_vendor.areaPrefix`. On an area a null row is
-- meaningful — it is what *stops* inheritance from an ancestor — whereas an issue has exactly one
-- level above it, so "inherit the area's prefix" is simply the absence of a row, which is what a
-- blank field in the issue dialog stores.
CREATE TABLE "issue_catalog_prefix" (
    "issueId" TEXT NOT NULL,
    "catalogVendorId" TEXT NOT NULL,
    "areaPrefix" TEXT NOT NULL,

    CONSTRAINT "issue_catalog_prefix_pkey" PRIMARY KEY ("issueId", "catalogVendorId")
);

ALTER TABLE "issue_catalog_prefix"
    ADD CONSTRAINT "issue_catalog_prefix_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_catalog_prefix"
    ADD CONSTRAINT "issue_catalog_prefix_catalogVendorId_fkey"
    FOREIGN KEY ("catalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
