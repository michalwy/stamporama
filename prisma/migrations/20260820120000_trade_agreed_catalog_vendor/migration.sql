-- The catalog a trade is agreed in is a **vendor**, not one of that vendor's books (#646).
--
-- `20260819120000_trades` gave `trade` a `catalogNameId` → `catalog_name`. That is wrong, and the
-- reason is what a `catalog_name` actually is: one book covering one part of the world. *Michel
-- Deutschland* prices nothing Polish. A trade routinely spans several areas — a swap of German
-- material for Polish is the ordinary case, not the corner one — so naming a single book would leave
-- every line outside its scope with nothing to value it against, and the alternative would be for a
-- trade to carry a *list* of books, one per area, which is a thing the collection already knows.
--
-- What two collectors actually agree on is the publisher: "we go by Michel". Which volume a given
-- line is read in then follows from that line's stamp and its area, through the same
-- `collection_area_catalog` resolution every other valuation in the app already uses. One agreed
-- fact, no per-area bookkeeping, and no way to name a catalog that cannot price half the trade.
--
-- No data migration: `trade` is introduced by the migration one step back, so the column being
-- replaced can hold nothing anywhere. Dropped and re-added rather than renamed, because it is a
-- different column pointing at a different table, not the same one under a new name.

ALTER TABLE "trade" DROP CONSTRAINT "trade_catalogNameId_fkey";
DROP INDEX "trade_catalogNameId_idx";
ALTER TABLE "trade" DROP COLUMN "catalogNameId";

ALTER TABLE "trade" ADD COLUMN "catalogVendorId" TEXT;

CREATE INDEX "trade_catalogVendorId_idx" ON "trade"("catalogVendorId");

-- RESTRICT, as the reference it replaces was: a vendor named on an agreement two people are holding
-- a copy of must not be deletable out from under it.
ALTER TABLE "trade" ADD CONSTRAINT "trade_catalogVendorId_fkey"
    FOREIGN KEY ("catalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
