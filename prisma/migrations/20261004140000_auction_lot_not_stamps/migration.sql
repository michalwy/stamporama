-- An auction lot can be marked as not stamps (#1624).
--
-- The collector sometimes bids on catalogues, literature or accessories and tracks them like any lot.
-- Such a lot carries no lines, so it read as *Not described*, and a won one had no way into the
-- purchase. Now it is marked, with an optional description of what it is, and a won one settles as a
-- purchase **expense** (ADR-0009 §1) rather than a lot.
--
-- `purchaseExpenseId` is the counterpart of `purchaseLotId`: unique, and `SET NULL` so deleting the
-- expense (or its purchase) leaves the bidding record standing. Every existing lot is stamps.
ALTER TABLE "auction_lot" ADD COLUMN "notStamps" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "auction_lot" ADD COLUMN "notStampsDescription" TEXT;
ALTER TABLE "auction_lot" ADD COLUMN "purchaseExpenseId" TEXT;

ALTER TABLE "auction_lot" ADD CONSTRAINT "auction_lot_purchaseExpenseId_fkey"
    FOREIGN KEY ("purchaseExpenseId") REFERENCES "purchase_expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "auction_lot_purchaseExpenseId_key" ON "auction_lot"("purchaseExpenseId");
