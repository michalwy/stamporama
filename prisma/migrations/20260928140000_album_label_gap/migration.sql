-- The space between a box and its label on an album page (#1420).
--
-- A template value, copied onto the album like every other (#308's rule). 0 is the default on both
-- columns because a label has always started on the box's own edge: an existing album and an
-- existing template keep their pages exactly.
ALTER TABLE "album_template" ADD COLUMN "labelGapMm" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "album" ADD COLUMN "labelGapMm" DOUBLE PRECISION NOT NULL DEFAULT 0;
