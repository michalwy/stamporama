-- Per-collection internal copy number (#268). `item."itemNo"` is the human-readable identifier a
-- collector writes on the physical piece: a sequence starting at 1 within each collection,
-- assigned on creation and never edited.
--
-- The next value is handed out from a counter on the owning collection rather than computed as
-- `max(itemNo) + 1`, because a deleted copy must not hand its number to the next one, and a bulk
-- lot intake takes a whole range in a single atomic statement.

ALTER TABLE "collection" ADD COLUMN "nextItemNo" INTEGER NOT NULL DEFAULT 1;

-- Added nullable, backfilled, then made NOT NULL — existing rows have no number yet.
ALTER TABLE "item" ADD COLUMN "itemNo" INTEGER;

-- Backfill in creation order per collection, oldest = 1, so the sequence reads as the order the
-- copies were entered. `id` breaks ties on identical timestamps (bulk intake writes a whole batch
-- with the same `createdAt`) to keep the numbering deterministic.
WITH numbered AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "collectionId"
            ORDER BY "createdAt" ASC, "id" ASC
        ) AS rn
    FROM "item"
)
UPDATE "item"
SET "itemNo" = numbered.rn
FROM numbered
WHERE "item"."id" = numbered."id";

ALTER TABLE "item" ALTER COLUMN "itemNo" SET NOT NULL;

-- Point each collection's counter past the numbers just handed out.
UPDATE "collection"
SET "nextItemNo" = sub.next
FROM (
    SELECT "collectionId", MAX("itemNo") + 1 AS next
    FROM "item"
    GROUP BY "collectionId"
) AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE UNIQUE INDEX "item_collectionId_itemNo_key" ON "item"("collectionId", "itemNo");
