-- Backfill primaryCatalogSortKey (#181) for existing issues and stamps. Mirrors the runtime
-- formula in src/lib/catalog-sort-key.ts (kept in sync per ADR-0014): the numeric value of the
-- effective primary-catalog vendor's number, else the lowest numeric across the row's numbers,
-- else NULL (no numeric catalog number -> sorts last).
--
-- Shared derivation (both statements): resolve each area's *effective* primary catalog by climbing
-- the area tree to the nearest ancestor with a primaryCatalogNameId set (matching
-- buildEffectivePrimaryCatalogMap), then map that catalog name to its vendor. `substring(... from
-- '^[0-9]+')` extracts the leading digits; NULLIF(...,'')::int yields NULL for non-numeric numbers.

-- ── Issues ────────────────────────────────────────────────────────────────────
WITH RECURSIVE walk AS (
    SELECT a.id AS area_id, a."primaryCatalogNameId", a."parentId", 0 AS depth
    FROM "collection_area" a
  UNION ALL
    SELECT w.area_id, p."primaryCatalogNameId", p."parentId", w.depth + 1
    FROM walk w
    JOIN "collection_area" p ON p.id = w."parentId"
    WHERE w."primaryCatalogNameId" IS NULL
),
eff AS (
  SELECT DISTINCT ON (area_id) area_id, "primaryCatalogNameId"
  FROM walk
  WHERE "primaryCatalogNameId" IS NOT NULL
  ORDER BY area_id, depth ASC
),
area_vendor AS (
  SELECT eff.area_id, cn."vendorId" AS vendor_id
  FROM eff
  JOIN "catalog_name" cn ON cn.id = eff."primaryCatalogNameId"
)
UPDATE "issue" i
SET "primaryCatalogSortKey" = COALESCE(
  (SELECT NULLIF(substring(icn."firstNumber" from '^[0-9]+'), '')::int
   FROM "issue_catalog_number" icn
   JOIN area_vendor av ON av.area_id = i."collectionAreaId" AND av.vendor_id = icn."catalogVendorId"
   WHERE icn."issueId" = i.id
   LIMIT 1),
  (SELECT MIN(NULLIF(substring(icn2."firstNumber" from '^[0-9]+'), '')::int)
   FROM "issue_catalog_number" icn2
   WHERE icn2."issueId" = i.id)
);

-- ── Stamps ────────────────────────────────────────────────────────────────────
WITH RECURSIVE walk AS (
    SELECT a.id AS area_id, a."primaryCatalogNameId", a."parentId", 0 AS depth
    FROM "collection_area" a
  UNION ALL
    SELECT w.area_id, p."primaryCatalogNameId", p."parentId", w.depth + 1
    FROM walk w
    JOIN "collection_area" p ON p.id = w."parentId"
    WHERE w."primaryCatalogNameId" IS NULL
),
eff AS (
  SELECT DISTINCT ON (area_id) area_id, "primaryCatalogNameId"
  FROM walk
  WHERE "primaryCatalogNameId" IS NOT NULL
  ORDER BY area_id, depth ASC
),
area_vendor AS (
  SELECT eff.area_id, cn."vendorId" AS vendor_id
  FROM eff
  JOIN "catalog_name" cn ON cn.id = eff."primaryCatalogNameId"
),
stamp_area AS (
  SELECT DISTINCT ON (sca."stampId") sca."stampId" AS stamp_id, sca."collectionAreaId" AS area_id
  FROM "stamp_collection_area" sca
  ORDER BY sca."stampId", sca."isPrimary" DESC
)
UPDATE "stamp" s
SET "primaryCatalogSortKey" = COALESCE(
  (SELECT NULLIF(substring(scn."number" from '^[0-9]+'), '')::int
   FROM "stamp_catalog_number" scn
   JOIN stamp_area sa ON sa.stamp_id = s.id
   JOIN area_vendor av ON av.area_id = sa.area_id AND av.vendor_id = scn."catalogVendorId"
   WHERE scn."stampId" = s.id
   LIMIT 1),
  (SELECT MIN(NULLIF(substring(scn2."number" from '^[0-9]+'), '')::int)
   FROM "stamp_catalog_number" scn2
   WHERE scn2."stampId" = s.id)
);
