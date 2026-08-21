-- **Interchangeable copies on a give line** (#657; ADR-0039 §13).
--
-- A give line names one copy, but where the collection holds several that answer the same
-- requirement — the same stamp, in the same condition, with the same certificate and the same
-- format — which one travels is still open, and the partner is the one who should decide it.
--
-- The pool they choose from is **derived, never stored**: it is what `listOfferableCopies` already
-- allows, matched on the full valuation key. No candidate table exists and none will — a stored pool
-- is a pool that is wrong the first time a copy is sold and nobody re-runs anything.
--
-- What this table stores is the collector's **exception**. Everything eligible is offered by default
-- and a row here says "not this one, not to this person" — `item_platform_exclusion`'s design
-- exactly: the presence of the row is the whole state, so setting it twice is a no-op and clearing
-- it is a delete, and there is no reason column, because anything worth writing down belongs in the
-- trade line's own notes.
--
-- Scoped to the **trade**, not to the line: two lines of one trade sharing a key would otherwise
-- need the same decision taken twice.
CREATE TABLE "trade_copy_block" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_copy_block_pkey" PRIMARY KEY ("id")
);

-- One decision per copy per trade; the unique is what lets the write be an upsert-by-absence.
CREATE UNIQUE INDEX "trade_copy_block_tradeId_itemId_key" ON "trade_copy_block"("tradeId", "itemId");
CREATE INDEX "trade_copy_block_itemId_idx" ON "trade_copy_block"("itemId");

-- Both **CASCADE**. A block records nothing that happened — unlike a sale line, or a give line on a
-- closed trade — so it follows the trade or the copy out of existence without leaving a trace to
-- guard.
ALTER TABLE "trade_copy_block" ADD CONSTRAINT "trade_copy_block_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trade_copy_block" ADD CONSTRAINT "trade_copy_block_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
