-- Scan sheets, tiles and the batch sequence move from a **lot** to its **purchase** (#586), and a
-- batch gains an optional name of its own (#587). One migration, because both rewrite `scan_sheet`.
--
-- Why the move. A batch number was meant to name the physical card on the desk. Twenty single
-- stamps won at one auction settle into twenty lots on one purchase (ADR-0009), arrive as one
-- parcel, and are scanned on one or two cards — so per lot, *batch 1* existed twenty times over in
-- one purchase and named nothing, and a card scanned "into lot 7" was invisible from the other
-- nineteen. Worse, a tile could only ever become a copy on the lot its sheet was uploaded under, so
-- the card could not be worked through at all.
--
-- The deeper reason, which is not a workaround: at a settlement the collector **does not know which
-- lot a stamp belongs to until they have identified it**. Asking for the lot at scanning time asks
-- the question before it can be answered. Identification is where it becomes answerable, and that
-- is where #567 already asks everything else about the copy.

-- ── The batch sequence ────────────────────────────────────────────────────────────────────────
ALTER TABLE "purchase" ADD COLUMN "nextScanBatchNo" INTEGER NOT NULL DEFAULT 1;

-- ── A name for the card (#587) ────────────────────────────────────────────────────────────────
--
-- On the sheet rather than in a table of its own, and written to **both** sides of a batch exactly
-- as `batchDoneAt` is (#567): a batch is already "the rows sharing a purchase and a batch number",
-- and a third entity to hold one nullable string would be a second place for a batch to exist. The
-- number stays primary — it is assigned rather than chosen, and two cards both called "Polska"
-- must still be tellable apart.
ALTER TABLE "scan_sheet" ADD COLUMN "label" TEXT;

-- ── Renumbering ───────────────────────────────────────────────────────────────────────────────
--
-- Batch numbers were unique per **lot**, so two lots of one purchase can both hold a batch 1 and
-- the new `(purchaseId, batchNo, side)` unique would collide. Existing batches are therefore
-- renumbered within their purchase, ordered by lot and then by their old number — which is
-- creation order for the ordinary case of one lot per parcel, where every number is unchanged.
--
-- Sheets and tiles are renumbered from the **same** map, because a tile finds its sheets through
-- `(purchase, batchNo)` and nothing else; a map built twice is a map that can disagree. Tiles of a
-- batch whose sheets were all deleted are in it too, hence the UNION rather than a join to sheets.
CREATE TEMPORARY TABLE "_scan_batch_map" AS
WITH batches AS (
    SELECT DISTINCT l."purchaseId", s."lotId", s."batchNo"
      FROM "scan_sheet" s
      JOIN "purchase_lot" l ON l."id" = s."lotId"
    UNION
    SELECT DISTINCT l."purchaseId", t."lotId", t."batchNo"
      FROM "scan_tile" t
      JOIN "purchase_lot" l ON l."id" = t."lotId"
)
SELECT
    "purchaseId",
    "lotId",
    "batchNo",
    (ROW_NUMBER() OVER (PARTITION BY "purchaseId" ORDER BY "lotId", "batchNo"))::int AS "newBatchNo"
  FROM batches;

CREATE INDEX "_scan_batch_map_idx" ON "_scan_batch_map"("lotId", "batchNo");

-- ── `scan_sheet` ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE "scan_sheet" ADD COLUMN "purchaseId" TEXT;

UPDATE "scan_sheet" s
   SET "purchaseId" = m."purchaseId",
       "batchNo"    = m."newBatchNo"
  FROM "_scan_batch_map" m
 WHERE m."lotId" = s."lotId" AND m."batchNo" = s."batchNo";

ALTER TABLE "scan_sheet" ALTER COLUMN "purchaseId" SET NOT NULL;

ALTER TABLE "scan_sheet" DROP CONSTRAINT "scan_sheet_lotId_fkey";
DROP INDEX "scan_sheet_lotId_batchNo_side_key";
DROP INDEX "scan_sheet_lotId_idx";
ALTER TABLE "scan_sheet" DROP COLUMN "lotId";

-- One front and at most one back per batch, now per purchase.
CREATE UNIQUE INDEX "scan_sheet_purchaseId_batchNo_side_key"
    ON "scan_sheet"("purchaseId", "batchNo", "side");
CREATE INDEX "scan_sheet_purchaseId_idx" ON "scan_sheet"("purchaseId");

ALTER TABLE "scan_sheet" ADD CONSTRAINT "scan_sheet_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── `scan_tile` ───────────────────────────────────────────────────────────────────────────────
--
-- **Deleting a lot no longer takes tiles with it.** They belong to the parcel, and a lot line
-- being corrected or removed is not the card being thrown away. A tile that had already become a
-- copy on that lot keeps its record and its `itemId` goes null through #567's `SetNull`, which is
-- the case the strip already draws as *copy deleted*.
ALTER TABLE "scan_tile" ADD COLUMN "purchaseId" TEXT;

UPDATE "scan_tile" t
   SET "purchaseId" = m."purchaseId",
       "batchNo"    = m."newBatchNo"
  FROM "_scan_batch_map" m
 WHERE m."lotId" = t."lotId" AND m."batchNo" = t."batchNo";

ALTER TABLE "scan_tile" ALTER COLUMN "purchaseId" SET NOT NULL;

ALTER TABLE "scan_tile" DROP CONSTRAINT "scan_tile_lotId_fkey";
DROP INDEX "scan_tile_lotId_idx";
DROP INDEX "scan_tile_lotId_batchNo_idx";
DROP INDEX "scan_tile_lotId_state_idx";
ALTER TABLE "scan_tile" DROP COLUMN "lotId";

CREATE INDEX "scan_tile_purchaseId_idx" ON "scan_tile"("purchaseId");
CREATE INDEX "scan_tile_purchaseId_batchNo_idx" ON "scan_tile"("purchaseId", "batchNo");
-- The order header's "N tiles unidentified" warning reads this pair.
CREATE INDEX "scan_tile_purchaseId_state_idx" ON "scan_tile"("purchaseId", "state");

ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The sequence's new floor ──────────────────────────────────────────────────────────────────
--
-- Taken from the renumbering rather than from the old per-lot counters: those counted per lot, and
-- their maximum would hand the next card a number a migrated batch already holds.
UPDATE "purchase" p
   SET "nextScanBatchNo" = m."maxBatchNo" + 1
  FROM (
    SELECT "purchaseId", MAX("newBatchNo") AS "maxBatchNo"
      FROM "_scan_batch_map"
     GROUP BY "purchaseId"
  ) m
 WHERE m."purchaseId" = p."id";

DROP TABLE "_scan_batch_map";

ALTER TABLE "purchase_lot" DROP COLUMN "nextScanBatchNo";
