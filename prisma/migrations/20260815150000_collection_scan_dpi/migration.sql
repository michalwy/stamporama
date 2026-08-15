-- Measuring on a scan (#598): the scale a distance in scan pixels is converted to millimetres with.
--
-- NOT NULL with a default, unlike the two retention settings on this table: there is no
-- instance-wide scanner for a null to defer to, and every collection scans at *something*. 1200 is
-- what this app's own reference cards were scanned at, so existing collections are backfilled to
-- the value they were almost certainly already using — and the field is on screen beside every
-- measurement it produces, so a collection that scans at 600 corrects it where the number is read
-- rather than discovering the assumption weeks later.
ALTER TABLE "collection" ADD COLUMN "scanDpi" INTEGER NOT NULL DEFAULT 1200;
