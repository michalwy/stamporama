-- Short per-collection numbers for the remaining major entities (#432), extending the pattern
-- `item."itemNo"` (#268) established and `offer."offerNo"` (#416) repeated: an issue, a purchase, a
-- sale and an auction lot each get a small sequential number of their own, so there is something to
-- quote about them — above all to the quick-jump box (#431), which takes a prefix and one of these.
--
-- Same allocation rule throughout, and for the same reason: the next value comes from a counter on
-- the owning collection, never `max(...) + 1`, so a deleted row retires its number rather than
-- handing it to the next one. A number that has been read out or written down must not start
-- meaning something else.
--
-- One counter per entity rather than one shared sequence: a collector counts purchases and issues
-- separately, and sharing would make every number jump for reasons nothing on screen explains.
--
-- Each number is added nullable, backfilled in creation order per collection (oldest = 1, `id`
-- breaking ties so a batch written in one transaction still numbers deterministically), then made
-- `NOT NULL` with the collection's counter moved past what was handed out.

ALTER TABLE "collection" ADD COLUMN "nextIssueNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "collection" ADD COLUMN "nextPurchaseNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "collection" ADD COLUMN "nextSaleNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "collection" ADD COLUMN "nextAuctionLotNo" INTEGER NOT NULL DEFAULT 1;

-- ── Issue ────────────────────────────────────────────────────────────────────

ALTER TABLE "issue" ADD COLUMN "issueNo" INTEGER;

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "collectionId" ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
    FROM "issue"
)
UPDATE "issue" SET "issueNo" = numbered.rn
FROM numbered WHERE "issue"."id" = numbered."id";

ALTER TABLE "issue" ALTER COLUMN "issueNo" SET NOT NULL;

UPDATE "collection" SET "nextIssueNo" = sub.next
FROM (SELECT "collectionId", MAX("issueNo") + 1 AS next FROM "issue" GROUP BY "collectionId") AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE UNIQUE INDEX "issue_collectionId_issueNo_key" ON "issue"("collectionId", "issueNo");

-- ── Purchase ─────────────────────────────────────────────────────────────────

ALTER TABLE "purchase" ADD COLUMN "purchaseNo" INTEGER;

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "collectionId" ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
    FROM "purchase"
)
UPDATE "purchase" SET "purchaseNo" = numbered.rn
FROM numbered WHERE "purchase"."id" = numbered."id";

ALTER TABLE "purchase" ALTER COLUMN "purchaseNo" SET NOT NULL;

UPDATE "collection" SET "nextPurchaseNo" = sub.next
FROM (SELECT "collectionId", MAX("purchaseNo") + 1 AS next FROM "purchase" GROUP BY "collectionId") AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE UNIQUE INDEX "purchase_collectionId_purchaseNo_key" ON "purchase"("collectionId", "purchaseNo");

-- ── Sale ─────────────────────────────────────────────────────────────────────

ALTER TABLE "sale" ADD COLUMN "saleNo" INTEGER;

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "collectionId" ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
    FROM "sale"
)
UPDATE "sale" SET "saleNo" = numbered.rn
FROM numbered WHERE "sale"."id" = numbered."id";

ALTER TABLE "sale" ALTER COLUMN "saleNo" SET NOT NULL;

UPDATE "collection" SET "nextSaleNo" = sub.next
FROM (SELECT "collectionId", MAX("saleNo") + 1 AS next FROM "sale" GROUP BY "collectionId") AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE UNIQUE INDEX "sale_collectionId_saleNo_key" ON "sale"("collectionId", "saleNo");

-- ── Auction lot ──────────────────────────────────────────────────────────────
--
-- A lot has no `collectionId` of its own — it reaches its collection through its sale — so the
-- partition, the counter update and the absent unique index all go through that join. The number is
-- deliberately not `lotNo`: that column holds the *house's* number for the lot, typed in, optional
-- and free to repeat.

ALTER TABLE "auction_lot" ADD COLUMN "auctionLotNo" INTEGER;

WITH numbered AS (
    SELECT l."id", ROW_NUMBER() OVER (
        PARTITION BY s."collectionId" ORDER BY l."createdAt" ASC, l."id" ASC
    ) AS rn
    FROM "auction_lot" l
    JOIN "auction_sale" s ON s."id" = l."auctionSaleId"
)
UPDATE "auction_lot" SET "auctionLotNo" = numbered.rn
FROM numbered WHERE "auction_lot"."id" = numbered."id";

ALTER TABLE "auction_lot" ALTER COLUMN "auctionLotNo" SET NOT NULL;

UPDATE "collection" SET "nextAuctionLotNo" = sub.next
FROM (
    SELECT s."collectionId", MAX(l."auctionLotNo") + 1 AS next
    FROM "auction_lot" l
    JOIN "auction_sale" s ON s."id" = l."auctionSaleId"
    GROUP BY s."collectionId"
) AS sub
WHERE "collection"."id" = sub."collectionId";

CREATE INDEX "auction_lot_auctionLotNo_idx" ON "auction_lot"("auctionLotNo");
