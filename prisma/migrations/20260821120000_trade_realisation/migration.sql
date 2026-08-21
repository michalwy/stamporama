-- **What actually happened, against what was agreed** (#642; ADR-0039 §11).
--
-- A trade list is a plan, not a fact. The agreement freezes at `agreed` and the partner holds a copy
-- of it, so it is not quietly edited; realisation is a **second layer** recorded on the same line —
-- pieces withdrawn while packing, pieces that never arrived — and the agreed figures and the frozen
-- valuations beside them are untouched by it.
--
-- Two columns and no table: a verdict is one fact about one line, one line has one verdict, and a row
-- of its own would be a second place for the same answer to live.
ALTER TABLE "trade_line" ADD COLUMN "fulfillment" TEXT NOT NULL DEFAULT 'pending';

-- Why: found damaged, could not be located, the parcel arrived two short. Free text, because the
-- reason is the collector's own memory of a parcel and no list of causes would fit it.
ALTER TABLE "trade_line" ADD COLUMN "fulfillmentNote" TEXT;

-- Every read of this asks "what on this trade has a verdict", and on nearly every trade the answer is
-- none — so the index carries only the rows that say something.
CREATE INDEX "trade_line_tradeId_fulfillment_idx" ON "trade_line"("tradeId", "fulfillment")
    WHERE "fulfillment" <> 'pending';
