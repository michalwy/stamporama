-- ADR-0013: collapse the sales `Lot` into `Offer`. An offer now owns its composition directly —
-- `offer` 1:N `offer_set`, and `offer_set` N:M `item` via `offer_set_item` (the cross-platform
-- thread). `sale_line` retargets from `lot` to `offer_set`. The `lot` / `lot_item` / `lot_sub_lot`
-- tables are dropped.
--
-- Clean replacement: the sales module carries no production data (whole module landed in v0.18).
-- Any existing offers/sales reference the retired lot model and are meaningless under the new
-- shape, so they are cleared here — inventory (stamps, purchases, copies) is untouched. Written
-- idempotently (IF [NOT] EXISTS / drop-then-add) so it converges even if a prior attempt applied
-- partially.

-- Clear the retired sales-module rows (inventory copies survive; only the sale packaging goes).
DELETE FROM "sale_line_item";
DELETE FROM "sale_line";
DELETE FROM "sale";
DELETE FROM "offer";

-- New: an offer's sets, and the copies in each set.
CREATE TABLE IF NOT EXISTS "offer_set" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "title" TEXT,

    CONSTRAINT "offer_set_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "offer_set_offerId_idx" ON "offer_set"("offerId");
ALTER TABLE "offer_set" DROP CONSTRAINT IF EXISTS "offer_set_offerId_fkey";
ALTER TABLE "offer_set" ADD CONSTRAINT "offer_set_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "offer_set_item" (
    "offerSetId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "offer_set_item_pkey" PRIMARY KEY ("offerSetId", "itemId")
);
CREATE INDEX IF NOT EXISTS "offer_set_item_itemId_idx" ON "offer_set_item"("itemId");
ALTER TABLE "offer_set_item" DROP CONSTRAINT IF EXISTS "offer_set_item_offerSetId_fkey";
ALTER TABLE "offer_set_item" ADD CONSTRAINT "offer_set_item_offerSetId_fkey"
    FOREIGN KEY ("offerSetId") REFERENCES "offer_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer_set_item" DROP CONSTRAINT IF EXISTS "offer_set_item_itemId_fkey";
ALTER TABLE "offer_set_item" ADD CONSTRAINT "offer_set_item_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Retarget sale_line: lot -> offer_set (table is now empty, so NOT NULL is safe).
ALTER TABLE "sale_line" DROP CONSTRAINT IF EXISTS "sale_line_lotId_fkey";
DROP INDEX IF EXISTS "sale_line_lotId_idx";
ALTER TABLE "sale_line" DROP COLUMN IF EXISTS "lotId";
ALTER TABLE "sale_line" ADD COLUMN IF NOT EXISTS "offerSetId" TEXT NOT NULL;
CREATE INDEX IF NOT EXISTS "sale_line_offerSetId_idx" ON "sale_line"("offerSetId");
ALTER TABLE "sale_line" DROP CONSTRAINT IF EXISTS "sale_line_offerSetId_fkey";
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_offerSetId_fkey"
    FOREIGN KEY ("offerSetId") REFERENCES "offer_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Offer no longer points at a lot.
ALTER TABLE "offer" DROP CONSTRAINT IF EXISTS "offer_lotId_fkey";
DROP INDEX IF EXISTS "offer_lotId_idx";
ALTER TABLE "offer" DROP COLUMN IF EXISTS "lotId";

-- Drop the retired lot tables (children first).
DROP TABLE IF EXISTS "lot_item";
DROP TABLE IF EXISTS "lot_sub_lot";
DROP TABLE IF EXISTS "lot";
