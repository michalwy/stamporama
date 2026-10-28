-- A location's code is per level (#2235): each location holds the code of its own level only, and
-- its full code is its levels' codes joined with dots from the top down (`A.B.C.1`), built where it
-- is shown. A level's code is any text without a dot, kept as typed, unique among its siblings
-- regardless of case — which is what keeps the full codes unique — instead of #2191's six letters
-- and digits unique across the collection.
--
-- Existing codes are recalculated per level by the rule in `src/lib/location-code.ts`, which
-- proposes the code for every new location — the two must agree:
--
-- - a location's code is the initial of its name's last word, or that word whole when it is a
--   number (`Klaser A` → `A`, `Szafa 1` → `1`), letters folded to ASCII and anything else dropped;
--   `L` when nothing is left;
-- - a clash among siblings takes the first free `A2`, `A3`…; the location made first keeps the
--   bare code.

DROP INDEX "location_collectionId_code_key";

-- Every code is first set to a value no generated code can be (generated codes are letters and
-- digits only), so the clash check below sees only the codes already recalculated.
UPDATE "location" SET "code" = '#' || "id";

DO $$
DECLARE
  loc RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR loc IN
    SELECT l."id", l."collectionId", l."parentId",
           CASE WHEN f."word" ~ '^[0-9]+$' THEN f."word" ELSE left(f."word", 1) END AS "token"
    FROM "location" l,
    LATERAL (
      SELECT regexp_replace(
               upper(translate(coalesce(substring(btrim(l."name") from '(\S+)$'), ''),
                               'ąćęłńóśźżäöüĄĆĘŁŃÓŚŹŻÄÖÜ', 'acelnoszzaouACELNOSZZAOU')),
               '[^A-Z0-9]', '', 'g') AS "word"
    ) f
    ORDER BY l."collectionId", l."createdAt", l."id"
  LOOP
    base := CASE WHEN loc."token" = '' THEN 'L' ELSE loc."token" END;
    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM "location"
      WHERE "collectionId" = loc."collectionId"
        AND "parentId" IS NOT DISTINCT FROM loc."parentId"
        AND lower("code") = lower(candidate)
    ) LOOP
      n := n + 1;
      candidate := base || n::text;
    END LOOP;
    UPDATE "location" SET "code" = candidate WHERE "id" = loc."id";
  END LOOP;
END $$;

-- Unique among siblings, regardless of case: the top level's siblings share a null parent, so the
-- nulls must count as equal (ADR-0006 §3's idiom). Prisma can express neither the expression nor
-- `NULLS NOT DISTINCT`, so the index lives here only.
CREATE UNIQUE INDEX "location_sibling_code_key"
    ON "location" ("collectionId", "parentId", lower("code"))
    NULLS NOT DISTINCT;
