-- Short per-collection listing number (#416), the offer-side counterpart of `item."itemNo"` (#268).
-- It exists because an offer's address has to fit somewhere very small: Colnect's private note
-- allows 100 characters (#402), which a cuid-based offer URL (#415) nearly fills on its own.
--
-- Same allocation rule as the copy number, for the same reason: the next value comes from a counter
-- on the owning collection rather than `max(offerNo) + 1`, so a deleted offer never hands its
-- number to the next one — a number that has been published in a marketplace note must not start
-- pointing somewhere else.
--
-- Its own counter rather than sharing `nextItemNo`: copies and listings are counted separately, and
-- one shared sequence would make both numbers jump for no reason a collector can see.

ALTER TABLE "collection" ADD COLUMN "nextOfferNo" INTEGER NOT NULL DEFAULT 1;

-- Added nullable, backfilled, then made NOT NULL — existing rows have no number yet.
ALTER TABLE "offer" ADD COLUMN "offerNo" INTEGER;

-- Backfill in creation order per collection, oldest = 1, so the sequence reads as the order the
-- listings were prepared. `id` breaks ties on identical timestamps (a duplicate-offer run writes
-- several rows in one transaction) to keep the numbering deterministic.
WITH numbered AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "collectionId"
            ORDER BY "createdAt" ASC, "id" ASC
        ) AS rn
    FROM "offer"
)
UPDATE "offer"
SET "offerNo" = numbered.rn
FROM numbered
WHERE "offer"."id" = numbered."id";

ALTER TABLE "offer" ALTER COLUMN "offerNo" SET NOT NULL;

-- Point each collection's counter past the numbers just handed out.
UPDATE "collection"
SET "nextOfferNo" = sub.next
FROM (
    SELECT "collectionId", MAX("offerNo") + 1 AS next
    FROM "offer"
    GROUP BY "collectionId"
) AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE UNIQUE INDEX "offer_collectionId_offerNo_key" ON "offer"("collectionId", "offerNo");
