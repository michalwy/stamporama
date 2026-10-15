-- The Replacements screen reviews the collection's duplicates (#1938, ADR-0070 as amended).
--
-- ## A copy may replace several
--
-- Picking the copy to keep among three makes it the new copy of two pairs, one for each copy it
-- replaces. `item_replacement_open_new_key` allowed one open pair per new copy, so it goes. The old
-- side keeps its index: a copy is still replaced by at most one other while its pair is open.
--
-- ## Keep all
--
-- `duplicate_keep_all` names the copies the collector said to keep, every one, when a stamp came up
-- in the review. A stamp stays out of the review while every copy it is reviewed over is named here,
-- so a copy joining the collection afterwards brings it back. One row per copy rather than per
-- stamp: the review groups by the *Split by …* switches, and a mark per copy holds under any of
-- them. Both references cascade — a deleted copy has nothing left to keep. The table is new, so
-- there is no data to carry.

DROP INDEX "item_replacement_open_new_key";

CREATE TABLE "duplicate_keep_all" (
    "itemId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_keep_all_pkey" PRIMARY KEY ("itemId")
);

CREATE INDEX "duplicate_keep_all_collectionId_idx" ON "duplicate_keep_all"("collectionId");

ALTER TABLE "duplicate_keep_all" ADD CONSTRAINT "duplicate_keep_all_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "duplicate_keep_all" ADD CONSTRAINT "duplicate_keep_all_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
