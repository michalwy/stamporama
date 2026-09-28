-- Where the album's title sits relative to the page frame (#1428).
--
-- Template values, copied onto the album like every other (#308's rule). `below-frame` is every
-- page printed before the column existed, so no album and no template moves. The gap is the white
-- each side of a title set into the frame line; 5 mm is measured off the collector's printed
-- PL-1928 card, and it draws nothing until a template chooses `in-frame`.
ALTER TABLE "album_template"
  ADD COLUMN "titlePlacement" TEXT NOT NULL DEFAULT 'below-frame',
  ADD COLUMN "titleFrameGapMm" DOUBLE PRECISION NOT NULL DEFAULT 5;

ALTER TABLE "album"
  ADD COLUMN "titlePlacement" TEXT NOT NULL DEFAULT 'below-frame',
  ADD COLUMN "titleFrameGapMm" DOUBLE PRECISION NOT NULL DEFAULT 5;
