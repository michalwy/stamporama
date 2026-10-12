-- A multi-lot Facebook post gets a short number of its own (#1842), per collection, so it can be
-- named — *Post #12 · lot 3* on each of its lots in the offers list — and reached by it. Same rule as
-- every other short number (#268, #416, #432): taken from a counter on the collection by
-- `allocateEntityNumber`, never `max(...) + 1`, so a dissolved post retires its number rather than
-- handing it on. Allocated by the application (ADR-0062's question: one path writes the row).
--
-- Existing posts are numbered once, oldest first within each collection.

ALTER TABLE "collection" ADD COLUMN "nextFacebookPostNo" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "facebook_post" ADD COLUMN "postNo" INTEGER;

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "collectionId" ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
    FROM "facebook_post"
)
UPDATE "facebook_post" SET "postNo" = numbered.rn
FROM numbered WHERE "facebook_post"."id" = numbered."id";

ALTER TABLE "facebook_post" ALTER COLUMN "postNo" SET NOT NULL;

UPDATE "collection" SET "nextFacebookPostNo" = sub.next
FROM (SELECT "collectionId", MAX("postNo") + 1 AS next FROM "facebook_post" GROUP BY "collectionId") AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE UNIQUE INDEX "facebook_post_collectionId_postNo_key" ON "facebook_post"("collectionId", "postNo");
