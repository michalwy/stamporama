-- The hawid strips a collection owns (#765).
--
-- An album page's box is a piece of hawid, not a stamp plus a margin: hawid comes as strips of a
-- fixed height that are cut across, so a box's height has to be a real strip's height. This table
-- is the stock the box rule (`src/lib/hawid.ts`) chooses from — height, the stock length a strip is
-- sold at, what the collector calls it, and the order the list is read in.
--
-- Nothing is backfilled and nothing is seeded. An empty stock is a collection that has not described
-- its drawer yet, and the rule answers *oversize* for every stamp until it has — which is visible,
-- rather than a silent default nobody chose.
--
-- Heights are unique per collection: the rule picks the shortest strip that fits, so a second row of
-- the same height is one that can never be chosen.

CREATE TABLE "hawid_strip" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "heightMm" DOUBLE PRECISION NOT NULL,
    "stockLengthMm" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hawid_strip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hawid_strip_collectionId_heightMm_key" ON "hawid_strip"("collectionId", "heightMm");

CREATE INDEX "hawid_strip_collectionId_idx" ON "hawid_strip"("collectionId");

ALTER TABLE "hawid_strip" ADD CONSTRAINT "hawid_strip_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
