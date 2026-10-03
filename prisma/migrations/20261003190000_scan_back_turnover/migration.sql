-- How a card's backs were made (#1555): each stamp turned over in place, or the whole card turned
-- over left to right or top to bottom — which mirrors the positions the backs are paired by.
--
-- Every back scanned so far was made the one way the app knew, so the default is the backfill.
ALTER TABLE "scan_sheet" ADD COLUMN "turnover" TEXT NOT NULL DEFAULT 'in_place';

-- The choice made last in the collection, offered for the next back.
ALTER TABLE "collection" ADD COLUMN "lastBackTurnover" TEXT NOT NULL DEFAULT 'in_place';

-- The choice rides a chunked upload to the sheet it becomes, as the scanning profile does.
ALTER TABLE "scan_upload" ADD COLUMN "turnover" TEXT;

-- Which backs were put on their tile by hand, so pairing a card's backs again keeps them.
ALTER TABLE "scan_tile" ADD COLUMN "backPairedByHand" BOOLEAN NOT NULL DEFAULT false;

-- A back sheet whose cut held a different number of boxes than its front was never paired by
-- position (#647): every back on it went on its tile by hand. Front and back counts do not change
-- after the cut — pairing and unpairing move a back between tiles without adding or removing one —
-- so the counts standing now are the counts the cut saw. On a card whose counts matched, a back
-- dragged into place afterwards cannot be told from one paired by position and stays unmarked.
UPDATE "scan_tile" t
SET "backPairedByHand" = true
FROM "scan_sheet" b
WHERE t."backSheetId" = b."id"
  AND t."frontSheetId" IS NOT NULL
  AND (
    SELECT count(*) FROM "scan_tile" f
    WHERE f."purchaseId" = b."purchaseId" AND f."batchNo" = b."batchNo" AND f."frontSheetId" IS NOT NULL
  ) <> (
    SELECT count(*) FROM "scan_tile" k WHERE k."backSheetId" = b."id"
  );
