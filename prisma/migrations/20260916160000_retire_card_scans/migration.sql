-- #1326: Card scans is retired, and every card it held moves onto an opening balance (ADR-0054).
--
-- #725 let a card belong to no order, for stamps already owned. #1323 gave that material a document
-- of its own — the opening balance, a purchase-order type — so Card scans became a second path one
-- step apart from the first, which is the state #1262 showed costs something to keep in step. The
-- collector decided on 2026-09-16 (#1321) to retire the screen and carry its work over rather than
-- keep both, or retire it without migrating.
--
-- **One opening balance per collection that has any purchase-less card**, carrying every one of
-- them: sheets, tiles in every state (unidentified, parked, discarded, consumed — names, notes and
-- shortlists travel with their rows untouched) and any upload still in flight. Its header is what the
-- collector chose: the title *Card scans*, dated the day the oldest of those cards was scanned, in the
-- collection's base currency (so no rate is frozen). It takes the next purchase number, as
-- `createPurchase` does.
--
-- **It gets one lot, with no title and no opening value.** A tile identifies into a copy on a lot
-- (`resolveTileLot`), and an opening balance is created with none, so without it every unidentified
-- tile moved here would be refused. One lot is also the case that asks nothing: identification uses
-- it silently. No value, because nothing about these stamps' worth was ever recorded — NULL, never
-- `0` (#1184).
--
-- **Copies already created from Card scans are not touched.** They stay delivered, on no lot, with a
-- cost that is not applicable; the collector decided they are not attached to the document. Their
-- tiles move and keep `itemId`, so the strip still shows what each piece became.
--
-- **Batch numbers are kept, not renumbered.** They are written on physical cards (#268/#432), and
-- they are already unique: they came off `collection.nextScanBatchNo`, guarded for purchase-less
-- sheets by the partial index below. The document is new, so nothing of its own can collide, and its
-- `nextScanBatchNo` continues past the highest number it receives.
--
-- **Then the schema says so.** With no screen left to scan outside an order, a card always belongs to
-- one: `purchaseId` becomes NOT NULL on all three tables, the partial index that stood in for the
-- purchase-less uniqueness goes (`(purchaseId, batchNo, side)` covers every row again), and the
-- collection's batch counter is dropped. `collectionId` stays — every read still scopes by it.

CREATE TEMP TABLE "_card_scans_document" AS
SELECT
  c."id" AS "collectionId",
  gen_random_uuid()::text AS "purchaseId",
  gen_random_uuid()::text AS "lotId",
  c."nextPurchaseNo" AS "purchaseNo",
  c."baseCurrency" AS "currency",
  COALESCE(
    (SELECT MIN(s."createdAt") FROM "scan_sheet" s
      WHERE s."collectionId" = c."id" AND s."purchaseId" IS NULL),
    (SELECT MIN(t."createdAt") FROM "scan_tile" t
      WHERE t."collectionId" = c."id" AND t."purchaseId" IS NULL),
    (SELECT MIN(u."createdAt") FROM "scan_upload" u
      WHERE u."collectionId" = c."id" AND u."purchaseId" IS NULL)
  )::date AS "purchasedAt",
  GREATEST(
    c."nextScanBatchNo",
    COALESCE(
      (SELECT MAX(s."batchNo") + 1 FROM "scan_sheet" s
        WHERE s."collectionId" = c."id" AND s."purchaseId" IS NULL),
      1
    ),
    COALESCE(
      (SELECT MAX(t."batchNo") + 1 FROM "scan_tile" t
        WHERE t."collectionId" = c."id" AND t."purchaseId" IS NULL),
      1
    ),
    COALESCE(
      (SELECT MAX(u."batchNo") + 1 FROM "scan_upload" u
        WHERE u."collectionId" = c."id" AND u."purchaseId" IS NULL),
      1
    )
  ) AS "nextScanBatchNo"
FROM "collection" c
WHERE EXISTS (SELECT 1 FROM "scan_sheet" s WHERE s."collectionId" = c."id" AND s."purchaseId" IS NULL)
   OR EXISTS (SELECT 1 FROM "scan_tile" t WHERE t."collectionId" = c."id" AND t."purchaseId" IS NULL)
   OR EXISTS (SELECT 1 FROM "scan_upload" u WHERE u."collectionId" = c."id" AND u."purchaseId" IS NULL);

-- The document. Every purchase-only field is left NULL and the status is `arrived`, which is the
-- shape CHECK `purchase_kind_shape` requires of an opening balance.
INSERT INTO "purchase" (
  "id", "collectionId", "purchaseNo", "kind", "title", "purchasedAt", "currency",
  "status", "nextScanBatchNo"
)
SELECT
  d."purchaseId", d."collectionId", d."purchaseNo", 'opening_balance', 'Card scans', d."purchasedAt",
  d."currency", 'arrived', d."nextScanBatchNo"
FROM "_card_scans_document" d;

UPDATE "collection" c
   SET "nextPurchaseNo" = c."nextPurchaseNo" + 1
  FROM "_card_scans_document" d
 WHERE d."collectionId" = c."id";

INSERT INTO "purchase_lot" ("id", "purchaseId", "title", "price", "status")
SELECT d."lotId", d."purchaseId", NULL, NULL, 'open'
FROM "_card_scans_document" d;

-- The cards themselves.
UPDATE "scan_sheet" s
   SET "purchaseId" = d."purchaseId"
  FROM "_card_scans_document" d
 WHERE s."collectionId" = d."collectionId" AND s."purchaseId" IS NULL;

UPDATE "scan_tile" t
   SET "purchaseId" = d."purchaseId"
  FROM "_card_scans_document" d
 WHERE t."collectionId" = d."collectionId" AND t."purchaseId" IS NULL;

UPDATE "scan_upload" u
   SET "purchaseId" = d."purchaseId"
  FROM "_card_scans_document" d
 WHERE u."collectionId" = d."collectionId" AND u."purchaseId" IS NULL;

DROP TABLE "_card_scans_document";

-- ── A card always belongs to a document ──────────────────────────────────────────────────────
DROP INDEX "scan_sheet_collection_batch_side_key";
ALTER TABLE "scan_sheet" ALTER COLUMN "purchaseId" SET NOT NULL;
ALTER TABLE "scan_tile" ALTER COLUMN "purchaseId" SET NOT NULL;
ALTER TABLE "scan_upload" ALTER COLUMN "purchaseId" SET NOT NULL;
ALTER TABLE "collection" DROP COLUMN "nextScanBatchNo";
