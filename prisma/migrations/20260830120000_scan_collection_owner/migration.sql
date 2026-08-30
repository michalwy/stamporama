-- #725: card scans hang off the **collection**, and a purchase is optional.
--
-- Before this, a `ScanSheet` / `ScanTile` / `ScanUpload` could only exist under a `Purchase`, so
-- the scan → cut → pair → identify pass was unreachable for stamps already owned. The collection is
-- the level a card on the desk actually exists at; the purchase says which parcel it arrived in,
-- when it arrived in one at all.
--
-- Backfilled from the purchase, so every existing row keeps the collection it was already in
-- (reached through `purchase.collectionId`), and nothing that reads a batch changes meaning.

-- ── scan_sheet ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "scan_sheet" ADD COLUMN "collectionId" TEXT;
UPDATE "scan_sheet" s SET "collectionId" = p."collectionId"
  FROM "purchase" p WHERE p."id" = s."purchaseId";
ALTER TABLE "scan_sheet" ALTER COLUMN "collectionId" SET NOT NULL;
ALTER TABLE "scan_sheet" ALTER COLUMN "purchaseId" DROP NOT NULL;
ALTER TABLE "scan_sheet"
  ADD CONSTRAINT "scan_sheet_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "scan_sheet_collectionId_idx" ON "scan_sheet"("collectionId");
CREATE INDEX "scan_sheet_collectionId_batchNo_idx" ON "scan_sheet"("collectionId", "batchNo");

-- The purchase-less batches need their own uniqueness: Postgres treats nulls as distinct, so the
-- existing `(purchaseId, batchNo, side)` unique index says nothing about them. A partial index is
-- the only shape that expresses it, and Prisma has no syntax for one — hence by hand, and hence
-- neither index is used as a `findUnique` key any more.
CREATE UNIQUE INDEX "scan_sheet_collection_batch_side_key"
  ON "scan_sheet"("collectionId", "batchNo", "side") WHERE "purchaseId" IS NULL;

-- ── scan_tile ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "scan_tile" ADD COLUMN "collectionId" TEXT;
UPDATE "scan_tile" t SET "collectionId" = p."collectionId"
  FROM "purchase" p WHERE p."id" = t."purchaseId";
ALTER TABLE "scan_tile" ALTER COLUMN "collectionId" SET NOT NULL;
ALTER TABLE "scan_tile" ALTER COLUMN "purchaseId" DROP NOT NULL;
ALTER TABLE "scan_tile"
  ADD CONSTRAINT "scan_tile_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "scan_tile_collectionId_idx" ON "scan_tile"("collectionId");
CREATE INDEX "scan_tile_collectionId_batchNo_idx" ON "scan_tile"("collectionId", "batchNo");
CREATE INDEX "scan_tile_collectionId_state_idx" ON "scan_tile"("collectionId", "state");

-- ── scan_upload ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE "scan_upload" ADD COLUMN "collectionId" TEXT;
UPDATE "scan_upload" u SET "collectionId" = p."collectionId"
  FROM "purchase" p WHERE p."id" = u."purchaseId";
-- An upload whose purchase vanished between the two statements is staging with nothing to finalize
-- into; it is swept on the ordinary TTL anyway, so it goes now rather than blocking the NOT NULL.
DELETE FROM "scan_upload" WHERE "collectionId" IS NULL;
ALTER TABLE "scan_upload" ALTER COLUMN "collectionId" SET NOT NULL;
ALTER TABLE "scan_upload" ALTER COLUMN "purchaseId" DROP NOT NULL;
ALTER TABLE "scan_upload"
  ADD CONSTRAINT "scan_upload_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "scan_upload_collectionId_idx" ON "scan_upload"("collectionId");

-- ── the per-collection batch sequence ─────────────────────────────────────────────────────────
-- The twin of `purchase.nextScanBatchNo`, for cards scanned outside any order. Separate rather than
-- shared: merging the sequences would renumber batches already written on physical cards.
ALTER TABLE "collection" ADD COLUMN "nextScanBatchNo" INTEGER NOT NULL DEFAULT 1;
