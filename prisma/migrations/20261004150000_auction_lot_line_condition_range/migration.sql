-- A lot line's condition can be unknown, or one of several (#1623).
--
-- A listing often does not say what condition its stamps are in — *Czysty* (unused) can be MNH or
-- MH, and the two can differ twofold in value — and a composition that is quietly wrong is worse
-- than one left open, because every headroom and recommendation is computed from it. So a line now
-- holds one of three:
--
--   settled      conditionId set, no rows below
--   one of set   conditionId null, two or more rows below (*MNH or MH*)
--   unknown      conditionId null, no rows below — any of the collection's conditions
--
-- Such a line is valued as a range over its possible conditions, and a won lot cannot be settled
-- into its purchase until every line has one. Existing lines all carry a condition and stay settled.
ALTER TABLE "auction_lot_line" ALTER COLUMN "conditionId" DROP NOT NULL;

CREATE TABLE "auction_lot_line_condition" (
  "auctionLotLineId" TEXT NOT NULL,
  "conditionId"      TEXT NOT NULL,

  CONSTRAINT "auction_lot_line_condition_pkey" PRIMARY KEY ("auctionLotLineId", "conditionId"),
  CONSTRAINT "auction_lot_line_condition_auctionLotLineId_fkey" FOREIGN KEY ("auctionLotLineId")
    REFERENCES "auction_lot_line"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auction_lot_line_condition_conditionId_fkey" FOREIGN KEY ("conditionId")
    REFERENCES "stamp_condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "auction_lot_line_condition_conditionId_idx" ON "auction_lot_line_condition"("conditionId");
