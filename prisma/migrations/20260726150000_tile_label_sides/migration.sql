-- Two tile annotations per stamp instead of one (#312).
--
-- What a collage tile has to say is two things at once: an identifier the buyer quotes back (the
-- location ref) and something descriptive beside it (a catalog number, a condition). Forcing both
-- through one template only produces a single long line, which then has to shrink to fit the tile's
-- width. Two templates, drawn flush left and flush right on the same strip at one shared font size,
-- keep both readable; either side may be left unset, and a lone annotation is centred.
--
-- The existing single template becomes the **left** annotation, which is where it was already drawn
-- for a tile that had only one.

ALTER TABLE "contact" RENAME COLUMN "tileLabelTemplate" TO "tileLabelLeftTemplate";
ALTER TABLE "contact" ADD COLUMN "tileLabelRightTemplate" TEXT;

ALTER TABLE "offer" RENAME COLUMN "photoLabelTemplate" TO "photoLabelLeftTemplate";
ALTER TABLE "offer" ADD COLUMN "photoLabelRightTemplate" TEXT;
