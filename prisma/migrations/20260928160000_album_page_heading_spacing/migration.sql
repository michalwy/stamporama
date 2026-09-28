-- The space above and below the album's title and the chapter heading on an album page (#1426).
--
-- Template values, copied onto the album like every other (#308's rule). The defaults are the
-- spacing every page had before the columns existed, so no album and no template moves:
--
-- - The running head sat on the top margin with nothing between it and the content: 0 and 0.
-- - The chapter heading borrowed the checklist headings' space above and below. Each row's own
--   figures are copied across, then the default is dropped: from here on the two are separate
--   values, and every writer states all four.
ALTER TABLE "album_template"
  ADD COLUMN "titleSpaceAboveMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "titleSpaceBelowMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "chapterSpaceAboveMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "chapterSpaceBelowMm" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "album_template"
  SET "chapterSpaceAboveMm" = "headingSpaceAboveMm", "chapterSpaceBelowMm" = "headingSpaceBelowMm";
ALTER TABLE "album_template"
  ALTER COLUMN "chapterSpaceAboveMm" DROP DEFAULT,
  ALTER COLUMN "chapterSpaceBelowMm" DROP DEFAULT;

ALTER TABLE "album"
  ADD COLUMN "titleSpaceAboveMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "titleSpaceBelowMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "chapterSpaceAboveMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "chapterSpaceBelowMm" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "album"
  SET "chapterSpaceAboveMm" = "headingSpaceAboveMm", "chapterSpaceBelowMm" = "headingSpaceBelowMm";
ALTER TABLE "album"
  ALTER COLUMN "chapterSpaceAboveMm" DROP DEFAULT,
  ALTER COLUMN "chapterSpaceBelowMm" DROP DEFAULT;
