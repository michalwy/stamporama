-- #728: a condition and a certificate status may carry a colour, so their chips are told apart at
-- a glance instead of reading as one grey line.
--
-- The value is a **palette key** (`green`, `blue`, … — see `src/lib/tag-colors.ts`), never a hex:
-- the chip is painted from `--color-tag-<hue>` tokens, which are defined once per theme, so one
-- stored value reads correctly on both the light and the dark page.
--
-- Null is a real answer — the neutral chip drawn before this — so the column stays nullable.
--
-- Backfill, so an existing collection looks the way a new one will without anyone opening
-- Settings. Conditions are matched on the six seeded default abbreviations first (#93), which is
-- what almost every collection still holds; anything else — a condition the collector added — and
-- every certificate status (never seeded, #94) takes a hue by position within its collection, out
-- of a pool that does not overlap the six, so a backfilled list has no two entries sharing a hue
-- until it runs longer than the pool.

ALTER TABLE "stamp_condition" ADD COLUMN "color" TEXT;
ALTER TABLE "certificate_status" ADD COLUMN "color" TEXT;

-- ── The seeded defaults, by abbreviation ──────────────────────────────────────────────────────
-- Mint grades warm through green/teal/amber, used ones cool through blue/violet, and FDC — a
-- cover rather than a stamp — sits apart in orange.
UPDATE "stamp_condition" SET "color" = CASE upper("abbreviation")
    WHEN 'MNH' THEN 'green'
    WHEN 'MH'  THEN 'teal'
    WHEN 'MNG' THEN 'amber'
    WHEN 'U'   THEN 'blue'
    WHEN 'CTO' THEN 'violet'
    WHEN 'FDC' THEN 'orange'
  END
WHERE upper("abbreviation") IN ('MNH', 'MH', 'MNG', 'U', 'CTO', 'FDC');

-- ── Everything else, by position ──────────────────────────────────────────────────────────────
UPDATE "stamp_condition" c SET "color" = pool."hue"
FROM (
  SELECT "id",
         (ARRAY['indigo', 'pink', 'red', 'slate'])[
           ((row_number() OVER (PARTITION BY "collectionId" ORDER BY "sortOrder", "id") - 1) % 4) + 1
         ] AS "hue"
  FROM "stamp_condition"
  WHERE "color" IS NULL
) pool
WHERE pool."id" = c."id";

UPDATE "certificate_status" s SET "color" = pool."hue"
FROM (
  SELECT "id",
         (ARRAY['blue', 'violet', 'teal', 'amber', 'green', 'orange', 'indigo', 'pink', 'red', 'slate'])[
           ((row_number() OVER (PARTITION BY "collectionId" ORDER BY "sortOrder", "id") - 1) % 10) + 1
         ] AS "hue"
  FROM "certificate_status"
) pool
WHERE pool."id" = s."id";
