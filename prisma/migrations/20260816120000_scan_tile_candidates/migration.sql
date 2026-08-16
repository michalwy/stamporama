-- The shortlist a parked tile carries (#607).
--
-- Discovering that a piece **cannot** be identified from its picture is not free: to know that a
-- watermark or a shade decides it, the collector has already worked out which stamps it could be.
-- #597 kept the note and threw that narrowing away, so the return sitting started from the catalogue
-- again. A row here is one possibility, and returning to the tile offers them as one-press
-- identifications.
--
-- The pair is the primary key: a stamp is on a tile's shortlist or it is not, so uniqueness needs no
-- separate index and a re-add is an upsert rather than a check.
--
-- Both foreign keys cascade. A deleted tile takes its shortlist (the candidates say nothing without
-- the piece), and a deleted stamp is no longer one of the possibilities — a shortlist is a working
-- note, not a record anything is owed to.
CREATE TABLE "scan_tile_candidate" (
    "tileId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_tile_candidate_pkey" PRIMARY KEY ("tileId","stampId")
);

-- For the stamp-side cascade, which has no index of its own from the composite key above.
CREATE INDEX "scan_tile_candidate_stampId_idx" ON "scan_tile_candidate"("stampId");

ALTER TABLE "scan_tile_candidate" ADD CONSTRAINT "scan_tile_candidate_tileId_fkey" FOREIGN KEY ("tileId") REFERENCES "scan_tile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_tile_candidate" ADD CONSTRAINT "scan_tile_candidate_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
