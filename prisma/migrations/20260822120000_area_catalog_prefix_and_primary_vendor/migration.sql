-- **Numbering vendors split from price books on an area; the prefix lifted to the area** (#675).
--
-- Two columns on `collection_area`:
--
-- * `catalogPrefix` — the area's prefix for *every* vendor. Until now the only place a prefix could
--   live was `collection_area_vendor.areaPrefix`, so `PL` was typed once per vendor (Mi, Sg, Yt, Fi)
--   on an area whose stamps all carry it. The per-vendor row stays as the *exception*, and the
--   resolution for an (area, vendor) pair becomes: the issue's override (#377), else walk up the
--   area tree and stop at the **first area that says anything** — a `collection_area_vendor` row for
--   this vendor or its own `catalogPrefix` — with the vendor row winning inside that one area. That
--   is `StampFormatFactor`'s rule (ADR-0020): *where* outranks *for which*.
--
-- * `primaryCatalogVendorId` — which vendor leads *numbering* (the catalog sort key #181, the
--   leading label, the primary chip). `primaryCatalogNameId` answered that by derivation while also
--   answering which book gives a copy its catalogue value (`item-valuation.ts`); the two are
--   separable and must be, or a vendor recorded without owning any of its books could never lead.
--
-- Nothing is dropped: `collection_area_vendor` and `collection_area_catalog` both stay, and both
-- keep their meaning — the first is now *written* rather than derived from the second at save time.

ALTER TABLE "collection_area" ADD COLUMN "catalogPrefix" TEXT;
ALTER TABLE "collection_area" ADD COLUMN "primaryCatalogVendorId" TEXT;

CREATE INDEX "collection_area_primaryCatalogVendorId_idx" ON "collection_area"("primaryCatalogVendorId");

-- SET NULL rather than CASCADE, matching `primaryCatalogNameId`: deleting a vendor must not delete
-- the areas that led their numbering with it, it must leave them without a leading vendor.
ALTER TABLE "collection_area" ADD CONSTRAINT "collection_area_primaryCatalogVendorId_fkey"
    FOREIGN KEY ("primaryCatalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the leading vendor from the vendor of the area's *own* primary catalog name, so nothing
-- moves in sorting, labels or valuation on the day of the migration. Only areas that declare a
-- primary name get one, which is what keeps the inheritance walk identical: both columns are
-- resolved by "nearest ancestor that sets one", and every area that sets a name now sets a vendor.
UPDATE "collection_area" a
SET "primaryCatalogVendorId" = n."vendorId"
FROM "catalog_name" n
WHERE n."id" = a."primaryCatalogNameId";

-- Lift the most common non-null prefix among the area's *own* vendor rows. Ties break on the prefix
-- text so the result does not depend on row order. An area whose rows carry no prefix at all keeps a
-- NULL `catalogPrefix` and is left entirely alone by the two statements below.
WITH counted AS (
    SELECT "collectionAreaId" AS area_id, "areaPrefix" AS prefix, COUNT(*) AS n
    FROM "collection_area_vendor"
    WHERE "areaPrefix" IS NOT NULL
    GROUP BY 1, 2
), winner AS (
    SELECT DISTINCT ON (area_id) area_id, prefix
    FROM counted
    ORDER BY area_id, n DESC, prefix ASC
)
UPDATE "collection_area" a
SET "catalogPrefix" = w.prefix
FROM winner w
WHERE w.area_id = a."id";

-- Pin what the lift would otherwise capture, **before** anything is deleted so the walk below still
-- sees the pre-lift rows. An area that inherited a vendor's prefix from an ancestor said nothing
-- about that vendor itself, and its own `catalogPrefix` now answers for every vendor it is silent
-- about — so the inherited value has to be written down here to survive. That is exactly the issue's
-- "repeating the Fischer exception on GG is how you keep it", applied once by the migration instead
-- of by hand. A NULL row is pinned as a NULL row: it says *no prefix here* and is the only thing
-- that stops the lifted value reaching down.
--
-- Only vendors mentioned somewhere up the chain are in scope. A vendor mentioned nowhere has no book
-- attached along that chain either, so no surface resolves a prefix for it today, and under the new
-- rule it simply picks up the area's own — which is what the area prefix is for.
INSERT INTO "collection_area_vendor" ("collectionAreaId", "catalogVendorId", "areaPrefix")
WITH RECURSIVE chain AS (
    SELECT a."id" AS area_id, a."id" AS anc_id, 0 AS depth
    FROM "collection_area" a
    UNION ALL
    SELECT c.area_id, p."parentId", c.depth + 1
    FROM chain c
    JOIN "collection_area" p ON p."id" = c.anc_id
    WHERE p."parentId" IS NOT NULL AND c.depth < 50
), resolved AS (
    SELECT DISTINCT ON (c.area_id, v."catalogVendorId")
           c.area_id,
           v."catalogVendorId" AS vendor_id,
           v."areaPrefix"      AS prefix
    FROM chain c
    JOIN "collection_area_vendor" v ON v."collectionAreaId" = c.anc_id
    ORDER BY c.area_id, v."catalogVendorId", c.depth ASC
)
SELECT r.area_id, r.vendor_id, r.prefix
FROM resolved r
JOIN "collection_area" a ON a."id" = r.area_id
WHERE a."catalogPrefix" IS NOT NULL
  AND r.prefix IS DISTINCT FROM a."catalogPrefix"
  AND NOT EXISTS (
      SELECT 1 FROM "collection_area_vendor" v
      WHERE v."collectionAreaId" = r.area_id AND v."catalogVendorId" = r.vendor_id
  );

-- Drop the rows the area level now says for them. Rows that *disagree* stay — they are the exception
-- the new model keeps — as do the pins just written, whose whole point is that they disagree.
DELETE FROM "collection_area_vendor" v
USING "collection_area" a
WHERE v."collectionAreaId" = a."id"
  AND a."catalogPrefix" IS NOT NULL
  AND v."areaPrefix" = a."catalogPrefix";
