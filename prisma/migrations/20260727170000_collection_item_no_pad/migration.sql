-- How many digits an internal copy number (#268) is padded to for display, per collection.
--
-- A display choice only: the stored `item."itemNo"` is the bare integer, so changing this rewrites
-- no rows, renumbers nothing, and cannot break a lookup — leading zeros are insignificant when the
-- search box parses a number. Listing templates may still override it per token (`{itemNo:3}`).
--
-- Its own migration rather than part of `20260727160000_item_internal_number`, which was already
-- applied: editing an applied migration changes its checksum and breaks `migrate deploy`.

ALTER TABLE "collection" ADD COLUMN "itemNoPad" INTEGER NOT NULL DEFAULT 5;
