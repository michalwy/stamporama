-- Every storage location has a short code (#2191): up to six letters and digits, unique within the
-- collection, stored upper-cased so the plain unique index is the case-insensitive one the
-- collector was promised. Existing locations are given one here by the rule in
-- `src/lib/location-code.ts`, which proposes the code for every new location — the two must agree:
--
-- - each level of the path gives the initial of its name's last word, or that word whole when it is
--   a number (`Szafa 1 › Klaser A` → `1A`), letters folded to ASCII and anything else dropped;
-- - the leaf end is kept when that runs past six, and an empty result is `L`;
-- - a clash takes the first free `ABX2`, `ABX3`…, the base giving up its front to fit; the location
--   made first keeps the bare code.

ALTER TABLE "location" ADD COLUMN "code" TEXT;

DO $$
DECLARE
  loc RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR loc IN
    WITH RECURSIVE "level" AS (
      SELECT l."id", l."collectionId", l."parentId", l."createdAt",
             CASE WHEN f."word" ~ '^[0-9]+$' THEN f."word" ELSE left(f."word", 1) END AS "token"
      FROM "location" l,
      LATERAL (
        SELECT regexp_replace(
                 upper(translate(coalesce(substring(btrim(l."name") from '(\S+)$'), ''),
                                 'ąćęłńóśźżäöüĄĆĘŁŃÓŚŹŻÄÖÜ', 'acelnoszzaouACELNOSZZAOU')),
                 '[^A-Z0-9]', '', 'g') AS "word"
      ) f
    ),
    "path" AS (
      SELECT v."id" AS "leafId", v."parentId", v."token" AS "tokens", 0 AS "depth"
      FROM "level" v
      UNION ALL
      SELECT p."leafId", v."parentId", v."token" || p."tokens", p."depth" + 1
      FROM "path" p
      JOIN "level" v ON v."id" = p."parentId"
      WHERE p."depth" < 50
    )
    SELECT v."id", v."collectionId", right(p."tokens", 6) AS "base"
    FROM "level" v
    JOIN "path" p ON p."leafId" = v."id" AND p."parentId" IS NULL
    ORDER BY v."collectionId", v."createdAt", v."id"
  LOOP
    base := CASE WHEN loc."base" = '' THEN 'L' ELSE loc."base" END;
    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM "location"
      WHERE "collectionId" = loc."collectionId" AND "code" = candidate
    ) LOOP
      n := n + 1;
      candidate := right(base, 6 - length(n::text)) || n::text;
    END LOOP;
    UPDATE "location" SET "code" = candidate WHERE "id" = loc."id";
  END LOOP;
END $$;

ALTER TABLE "location" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "location_collectionId_code_key" ON "location"("collectionId", "code");
