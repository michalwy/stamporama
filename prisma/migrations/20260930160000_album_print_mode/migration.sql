-- How an album entry prints relative to its issue (#1509), and the sub-heading it may print under.
--
-- `album_entry.printMode` is null on every existing row: null follows the default rule, which is
-- derived on read (`album-print-mode.ts`) — an issue with one checklist in the album prints it as
-- before, an issue with several prints its title once over them. Live sheets re-plan; printed cards
-- keep what they printed.
--
-- The sub-heading is a sixth type role, on the template and copied onto the album like every other
-- value (#308's rule). Every existing row takes the collector's own `STAMP_H2`: Liberation Sans
-- Italic (Arial Italic's metric twin) at 10 pt, 6 mm above and 3 mm below. A card stored before this
-- reads the same four values (`parseAlbumSnapshot`), so the migration reports no card as changed.
ALTER TABLE "album_entry" ADD COLUMN "printMode" TEXT;

ALTER TABLE "album_template"
  ADD COLUMN "subheadingSpaceAboveMm" DOUBLE PRECISION NOT NULL DEFAULT 6,
  ADD COLUMN "subheadingSpaceBelowMm" DOUBLE PRECISION NOT NULL DEFAULT 3,
  ADD COLUMN "subheadingFace" TEXT NOT NULL DEFAULT 'liberation-sans-italic',
  ADD COLUMN "subheadingSizePt" DOUBLE PRECISION NOT NULL DEFAULT 10;

ALTER TABLE "album"
  ADD COLUMN "subheadingSpaceAboveMm" DOUBLE PRECISION NOT NULL DEFAULT 6,
  ADD COLUMN "subheadingSpaceBelowMm" DOUBLE PRECISION NOT NULL DEFAULT 3,
  ADD COLUMN "subheadingFace" TEXT NOT NULL DEFAULT 'liberation-sans-italic',
  ADD COLUMN "subheadingSizePt" DOUBLE PRECISION NOT NULL DEFAULT 10;
