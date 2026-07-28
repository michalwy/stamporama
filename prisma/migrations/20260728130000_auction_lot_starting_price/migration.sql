-- The price an auction lot opened at (ADR-0021, follow-up to #350/#351). Nullable: not every
-- listing states one, and it is a record rather than an input — it never substitutes for
-- `currentBid`, since a lot nobody has bid on costs nothing whatever it opens at.
ALTER TABLE "auction_lot" ADD COLUMN "startingPrice" DECIMAL(10,2);
