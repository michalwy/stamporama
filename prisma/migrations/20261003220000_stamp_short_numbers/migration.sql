-- A short per-collection number for every stamp, variants included (#1574): the one major record
-- that had nothing to quote but its catalogue numbers, which differ per catalogue and repeat across
-- areas. Same rule as every other short number (#268, #416, #432): taken from a counter on the
-- collection, never `max(...) + 1`, so a deleted stamp retires its number rather than handing it on.
--
-- Unlike the others it is allocated **by the database** (ADR-0062): a `BEFORE INSERT` trigger bumps
-- `collection."nextStampNo"` with the same atomic `UPDATE ... RETURNING` `allocateEntityNumber`
-- runs, so every insert path — the app's own, nested creates, fixtures, raw SQL — gets a number
-- without having to remember to ask for one. A value supplied by the caller is overwritten, and an
-- update that would change the number is refused.
--
-- Existing stamps are numbered once, **in catalogue order within each area** (decided on #1574), so
-- the numbers read sensibly from the start rather than in the order the rows happened to be typed:
-- areas in tree order (siblings by `sortOrder`, then name, as the app lists them; a parent before
-- its children), and within an area by the primary catalogue sort key (a variant's key follows its
-- base's), then age. A stamp's area is its primary area link, else any link; a stamp with no link
-- at all falls back to its issue's area, and one with neither comes last.

ALTER TABLE "collection" ADD COLUMN "nextStampNo" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "stamp" ADD COLUMN "stampNo" INTEGER;

WITH RECURSIVE ranked_area AS (
    SELECT "id", "parentId", ROW_NUMBER() OVER (
        PARTITION BY "collectionId", "parentId" ORDER BY "sortOrder" ASC, "name" ASC, "id" ASC
    ) AS rank
    FROM "collection_area"
),
area_path AS (
    SELECT "id", ARRAY[rank] AS path
    FROM ranked_area
    WHERE "parentId" IS NULL
    UNION ALL
    SELECT c."id", p.path || c.rank
    FROM ranked_area c
    JOIN area_path p ON p."id" = c."parentId"
),
stamp_area AS (
    SELECT s."id",
           COALESCE(
               (SELECT l."collectionAreaId" FROM "stamp_collection_area" l
                 WHERE l."stampId" = s."id"
                 ORDER BY l."isPrimary" DESC, l."collectionAreaId" ASC LIMIT 1),
               (SELECT i."collectionAreaId" FROM "issue_member" m
                  JOIN "issue" i ON i."id" = m."issueId"
                 WHERE m."stampId" = s."id"
                 ORDER BY m."issueId" ASC LIMIT 1)
           ) AS "areaId"
    FROM "stamp" s
),
numbered AS (
    SELECT s."id", ROW_NUMBER() OVER (
        PARTITION BY s."collectionId"
        ORDER BY ap.path ASC NULLS LAST,
                 s."primaryCatalogSortKey" ASC NULLS LAST,
                 s."createdAt" ASC,
                 s."id" ASC
    ) AS rn
    FROM "stamp" s
    JOIN stamp_area sa ON sa."id" = s."id"
    LEFT JOIN area_path ap ON ap."id" = sa."areaId"
)
UPDATE "stamp" SET "stampNo" = numbered.rn
FROM numbered WHERE "stamp"."id" = numbered."id";

ALTER TABLE "stamp" ALTER COLUMN "stampNo" SET NOT NULL;

UPDATE "collection" SET "nextStampNo" = sub.next
FROM (SELECT "collectionId", MAX("stampNo") + 1 AS next FROM "stamp" GROUP BY "collectionId") AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE UNIQUE INDEX "stamp_collectionId_stampNo_key" ON "stamp"("collectionId", "stampNo");

-- ── Allocation ───────────────────────────────────────────────────────────────
--
-- The row lock the `UPDATE` takes on the collection serialises concurrent inserts into one
-- collection, exactly as `allocateEntityNumber` does, and a rolled-back insert rolls the bump back
-- with it, so a failed create burns no number.

CREATE FUNCTION "stamp_allocate_stamp_no"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "collection" SET "nextStampNo" = "nextStampNo" + 1
     WHERE "id" = NEW."collectionId"
     RETURNING "nextStampNo" - 1 INTO NEW."stampNo";
    RETURN NEW;
END;
$$;

CREATE TRIGGER "stamp_allocate_stamp_no"
    BEFORE INSERT ON "stamp"
    FOR EACH ROW EXECUTE FUNCTION "stamp_allocate_stamp_no"();

-- A number that has been quoted must not come to mean something else, so it never changes.
CREATE FUNCTION "stamp_keep_stamp_no"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."stampNo" IS DISTINCT FROM OLD."stampNo" THEN
        RAISE EXCEPTION 'A stamp''s number never changes (stamp %, #% → #%).',
            OLD."id", OLD."stampNo", NEW."stampNo";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "stamp_keep_stamp_no"
    BEFORE UPDATE OF "stampNo" ON "stamp"
    FOR EACH ROW EXECUTE FUNCTION "stamp_keep_stamp_no"();
