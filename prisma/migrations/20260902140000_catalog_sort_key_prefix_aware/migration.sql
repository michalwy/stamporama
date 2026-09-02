-- Prefix-aware catalog sort key (#181; ADR-0014). The key was the leading-digits integer of a
-- catalog number, so every family Michel writes with a letter prefix — P (Porto), Bl (blocks),
-- D (Dienst), W/S/Zd — parsed to NULL and fell into the number-less bucket at the end of every
-- list, ordered by name: "P15" read before "P1—14". The key becomes text holding
-- <prefix><10-digit zero-padded number><suffix>, lowercase ("200" -> "0000000200", "200a" ->
-- "0000000200a", "P15" -> "p0000000015"), so a family's numbers compare numerically as text and
-- ASCII's digits-before-letters puts the basic numbering first with each prefix as its own block
-- after it. COLLATE "C" pins that byte order: the same keys are compared in memory by JS `<`.
--
-- Mirrors the runtime formula in src/lib/catalog-sort-key.ts (kept in sync per ADR-0014): the key
-- of the effective primary-catalog vendor's number, else the lowest key across the row's numbers,
-- else NULL (no digits anywhere -> sorts last). The effective primary vendor is resolved by
-- climbing the area tree to the nearest ancestor with `primaryCatalogVendorId` set, matching
-- buildPrimaryVendorByAreaMap — the vendor, not the price book, since ADR-0040 split the two.
--
-- The old integer values are dropped rather than converted: every row is recomputed below, and a
-- converted key would be wrong for exactly the rows this migration exists to fix.

DROP INDEX "issue_collectionId_year_primaryCatalogSortKey_idx";
DROP INDEX "issue_collectionId_primaryCatalogSortKey_idx";
DROP INDEX "stamp_collectionId_issuedYear_primaryCatalogSortKey_idx";
DROP INDEX "stamp_collectionId_primaryCatalogSortKey_idx";

ALTER TABLE "issue"
  ALTER COLUMN "primaryCatalogSortKey" TYPE TEXT COLLATE "C" USING NULL;
ALTER TABLE "stamp"
  ALTER COLUMN "primaryCatalogSortKey" TYPE TEXT COLLATE "C" USING NULL;

CREATE INDEX "issue_collectionId_year_primaryCatalogSortKey_idx"
  ON "issue" ("collectionId", "year", "primaryCatalogSortKey");
CREATE INDEX "issue_collectionId_primaryCatalogSortKey_idx"
  ON "issue" ("collectionId", "primaryCatalogSortKey");

CREATE INDEX "stamp_collectionId_issuedYear_primaryCatalogSortKey_idx"
  ON "stamp" ("collectionId", "issuedYear", "primaryCatalogSortKey");
CREATE INDEX "stamp_collectionId_primaryCatalogSortKey_idx"
  ON "stamp" ("collectionId", "primaryCatalogSortKey");

-- ── Issues ────────────────────────────────────────────────────────────────────
WITH RECURSIVE walk AS (
    SELECT a.id AS area_id, a."primaryCatalogVendorId", a."parentId", 0 AS depth
    FROM "collection_area" a
  UNION ALL
    SELECT w.area_id, p."primaryCatalogVendorId", p."parentId", w.depth + 1
    FROM walk w
    JOIN "collection_area" p ON p.id = w."parentId"
    WHERE w."primaryCatalogVendorId" IS NULL
),
eff AS (
  SELECT DISTINCT ON (area_id) area_id, "primaryCatalogVendorId" AS vendor_id
  FROM walk
  WHERE "primaryCatalogVendorId" IS NOT NULL
  ORDER BY area_id, depth ASC
),
keys AS (
  SELECT icn."issueId" AS issue_id,
         icn."catalogVendorId" AS vendor_id,
         (lower((x.m)[1]) || lpad((x.m)[2], 10, '0') || lower((x.m)[3])) COLLATE "C" AS key
  FROM "issue_catalog_number" icn
  CROSS JOIN LATERAL (
    SELECT regexp_match(icn."firstNumber", '^\s*([A-Za-z]*)\s*([0-9]+)([A-Za-z]*)') AS m
  ) x
  WHERE x.m IS NOT NULL
)
UPDATE "issue" i
SET "primaryCatalogSortKey" = COALESCE(
  (SELECT k.key
   FROM keys k
   JOIN eff ON eff.area_id = i."collectionAreaId" AND eff.vendor_id = k.vendor_id
   WHERE k.issue_id = i.id
   LIMIT 1),
  (SELECT MIN(k2.key) FROM keys k2 WHERE k2.issue_id = i.id)
);

-- ── Stamps ────────────────────────────────────────────────────────────────────
WITH RECURSIVE walk AS (
    SELECT a.id AS area_id, a."primaryCatalogVendorId", a."parentId", 0 AS depth
    FROM "collection_area" a
  UNION ALL
    SELECT w.area_id, p."primaryCatalogVendorId", p."parentId", w.depth + 1
    FROM walk w
    JOIN "collection_area" p ON p.id = w."parentId"
    WHERE w."primaryCatalogVendorId" IS NULL
),
eff AS (
  SELECT DISTINCT ON (area_id) area_id, "primaryCatalogVendorId" AS vendor_id
  FROM walk
  WHERE "primaryCatalogVendorId" IS NOT NULL
  ORDER BY area_id, depth ASC
),
stamp_area AS (
  SELECT DISTINCT ON (sca."stampId") sca."stampId" AS stamp_id, sca."collectionAreaId" AS area_id
  FROM "stamp_collection_area" sca
  ORDER BY sca."stampId", sca."isPrimary" DESC
),
keys AS (
  SELECT scn."stampId" AS stamp_id,
         scn."catalogVendorId" AS vendor_id,
         (lower((x.m)[1]) || lpad((x.m)[2], 10, '0') || lower((x.m)[3])) COLLATE "C" AS key
  FROM "stamp_catalog_number" scn
  CROSS JOIN LATERAL (
    SELECT regexp_match(scn."number", '^\s*([A-Za-z]*)\s*([0-9]+)([A-Za-z]*)') AS m
  ) x
  WHERE x.m IS NOT NULL
)
UPDATE "stamp" s
SET "primaryCatalogSortKey" = COALESCE(
  (SELECT k.key
   FROM keys k
   JOIN stamp_area sa ON sa.stamp_id = s.id
   JOIN eff ON eff.area_id = sa.area_id AND eff.vendor_id = k.vendor_id
   WHERE k.stamp_id = s.id
   LIMIT 1),
  (SELECT MIN(k2.key) FROM keys k2 WHERE k2.stamp_id = s.id)
);
