-- A picture remembers the card scan it was cut from (#1915).
--
-- A batch's back scan can now be removed or replaced, and the copies already made from its tiles
-- lose the back picture that scan gave them. Ownership is no help in finding it: a tile's crops move
-- onto the copy by reassigning `tileId` to `itemId` (#567), and the copy's `back` role can since have
-- been given to a picture the collector took on the copy. So provenance is its own column, written
-- with every crop and never moved, and the removal takes exactly the pictures that name the scan.
--
-- `SET NULL`: deleting a batch (#1218) leaves the copies' pictures as they are, and only the record
-- of where they were cut from goes with the scan.

ALTER TABLE "photo" ADD COLUMN "scanSheetId" TEXT;

CREATE INDEX "photo_scanSheetId_idx" ON "photo"("scanSheetId");

ALTER TABLE "photo" ADD CONSTRAINT "photo_scanSheetId_fkey"
    FOREIGN KEY ("scanSheetId") REFERENCES "scan_sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Backfill ─────────────────────────────────────────────────────────────────────────────────────
--
-- A tile's own pictures are its crops, one per side, so the side's sheet is the answer.
UPDATE "photo" AS p
SET "scanSheetId" = CASE p."role" WHEN 'front' THEN t."frontSheetId" ELSE t."backSheetId" END
FROM "scan_tile" AS t
WHERE p."tileId" = t."id"
  AND p."role" IN ('front', 'back');

-- A copy's pictures are attributed only where the answer is certain enough to delete by: the copy
-- came from exactly one consumed tile with that side, and the picture in that role still has the
-- crop's own size — the box, either way round, since a crop is cut turned (#1006). A picture the
-- collector put on the copy afterwards is left unattributed, and so is never taken by a removal.
UPDATE "photo" AS p
SET "scanSheetId" = src."sheetId"
FROM (
    SELECT MIN(t."itemId") AS "itemId", 'front' AS "role", MIN(t."frontSheetId") AS "sheetId",
           MIN(t."frontW") AS "w", MIN(t."frontH") AS "h"
    FROM "scan_tile" AS t
    WHERE t."state" = 'consumed' AND t."itemId" IS NOT NULL AND t."frontSheetId" IS NOT NULL
    GROUP BY t."itemId"
    HAVING COUNT(*) = 1
    UNION ALL
    SELECT MIN(t."itemId"), 'back', MIN(t."backSheetId"), MIN(t."backW"), MIN(t."backH")
    FROM "scan_tile" AS t
    WHERE t."state" = 'consumed' AND t."itemId" IS NOT NULL AND t."backSheetId" IS NOT NULL
    GROUP BY t."itemId"
    HAVING COUNT(*) = 1
) AS src
WHERE p."itemId" = src."itemId"
  AND p."role" = src."role"
  AND (
    (p."original_width" = src."w" AND p."original_height" = src."h")
    OR (p."original_width" = src."h" AND p."original_height" = src."w")
  );
