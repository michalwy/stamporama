-- **Closing a trade turns it into inventory** (#644; ADR-0039 §12).
--
-- The incoming half of an exchange becomes a `Purchase` — supplier the partner, and a column saying
-- where it came from — so the whole intake apparatus answers for it: scan sheets, tiles, the
-- tile-to-line binding, the pool split, ROI. Nothing is duplicated and nothing pretends the collector
-- bought anything.
--
-- There is **no money on it**. The lot prices are the carried-over cost basis of the copies that went
-- the other way, so value changes form rather than being spent: no revenue, no profit, no cash, and
-- the profit appears — truthfully — on a real sale later. The outgoing side needs no column at all;
-- a copy has left when a give line of a **closed** trade names it and that line still commits it.

-- 1:1, and `RESTRICT` because a trade that has already been turned into inventory must not vanish
-- from under the purchase holding its cost. The same guard `purchase.contactId` carries, for the
-- same reason: a record of where something came from is half a record without it.
ALTER TABLE "purchase" ADD COLUMN "tradeId" TEXT;
CREATE UNIQUE INDEX "purchase_tradeId_key" ON "purchase"("tradeId");
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One lot per **receive line**, rather than one lot for the whole trade. That is what makes the
-- intake apparatus answer for a trade at all: a tile becomes a copy, the copy sits on a lot, and the
-- lot names the line — so *what was promised* and *what actually came* are two ends of one chain.
-- A substituted variant is that chain read out and a bonus is a copy no line asked for; neither is
-- stored, both are derived.
ALTER TABLE "purchase_lot" ADD COLUMN "tradeLineId" TEXT;
CREATE UNIQUE INDEX "purchase_lot_tradeLineId_key" ON "purchase_lot"("tradeLineId");
ALTER TABLE "purchase_lot" ADD CONSTRAINT "purchase_lot_tradeLineId_fkey"
    FOREIGN KEY ("tradeLineId") REFERENCES "trade_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
