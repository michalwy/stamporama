-- Retained card scans get a retention period of their own (#578).
--
-- #567 stamps `scan_sheet.batchDoneAt` when the last tile of a batch leaves `unidentified`; from
-- that moment a consumed tile refuses a re-cut, so the retained original — the largest object this
-- app stores — has no remaining function. This is the sweep that acts on it.
--
-- The period is a **collection setting** (#577's rule) in its own nullable column, holding exactly
-- what `STAMPORAMA_SCAN_SHEET_TTL_DAYS` holds — `off`/`never` for keep for ever, `0` to sweep at the
-- next pass, otherwise days — so the one parser that already reads the closed-offer grammar reads
-- this too. Its own column rather than the closed-offer one because a collector may keep card scans
-- for ever while purging offer images weekly.
--
-- Null means *no opinion*, deferring to the environment variable and then to the built-in default,
-- which for this setting is **keep for ever**: a generated image is output and a card scan is a
-- source (#137), so nothing is swept until a collector asks for it.
ALTER TABLE "collection" ADD COLUMN "scanSheetTtlDays" TEXT;

-- The sweep deletes the **bytes and not the row**. A purged sheet keeps its row, says when it was
-- purged, and reports `sizeBytes = 0` so the collection's storage total drops without any reader
-- needing to know this column exists. A re-cut then refuses with "the scan has been deleted" rather
-- than failing on a missing file halfway through.
ALTER TABLE "scan_sheet" ADD COLUMN "purgedAt" TIMESTAMP(3);
