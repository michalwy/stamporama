-- Ornamental page frames (#1427): the gap between the two rules of a double border, a corner
-- ornament drawn at each corner of the frame, and the collector's own uploaded ornaments.
--
-- Template values, copied onto the album like every other (#308's rule). The defaults keep every
-- existing template and album exactly as it prints today: 1.2 mm is the gap the PDF has always drawn
-- a double border with, and `none` draws no ornament, so the 25 mm size is read by nothing until an
-- ornament is chosen.
ALTER TABLE "album_template" ADD COLUMN "borderGapMm" DOUBLE PRECISION NOT NULL DEFAULT 1.2;
ALTER TABLE "album_template" ADD COLUMN "frameOrnament" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "album_template" ADD COLUMN "frameOrnamentSizeMm" DOUBLE PRECISION NOT NULL DEFAULT 25;
ALTER TABLE "album" ADD COLUMN "borderGapMm" DOUBLE PRECISION NOT NULL DEFAULT 1.2;
ALTER TABLE "album" ADD COLUMN "frameOrnament" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "album" ADD COLUMN "frameOrnamentSizeMm" DOUBLE PRECISION NOT NULL DEFAULT 25;

-- The collector's own corner ornaments. `drawing` is the uploaded SVG as read into outlines; the file
-- itself stays in storage under `storageKey`.
CREATE TABLE "album_ornament" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "drawing" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_ornament_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "album_ornament_collectionId_name_key" ON "album_ornament"("collectionId", "name");
CREATE INDEX "album_ornament_collectionId_idx" ON "album_ornament"("collectionId");

ALTER TABLE "album_ornament" ADD CONSTRAINT "album_ornament_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
