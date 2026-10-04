-- Lots and sales written through the agent API carry a *to review* marker (#1626).
--
-- The collector accepts an assistant writing auction lots only if everything it created or changed
-- is visibly waiting for review, and that has to be enforced rather than left to a tag the
-- assistant could forget. So every API write sets the marker and only the collector's *Confirm*
-- clears it; editing a marked lot in the app leaves it standing, because reviewing is a deliberate
-- act. The marker says what the API did, so it is three columns rather than a flag:
--
--   apiReviewAt       the latest API write since the last confirm; NULL means no marker at all
--   apiReviewCreated  the API created the record (rather than only changing one)
--   apiReviewFields   what the API changed, accumulated across writes until confirmed
--
-- Nothing existing was written through the API — the auction surface was read-only until now — so
-- every row starts unmarked.
ALTER TABLE "auction_sale" ADD COLUMN "apiReviewAt" TIMESTAMP(3);
ALTER TABLE "auction_sale" ADD COLUMN "apiReviewCreated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "auction_sale" ADD COLUMN "apiReviewFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "auction_lot" ADD COLUMN "apiReviewAt" TIMESTAMP(3);
ALTER TABLE "auction_lot" ADD COLUMN "apiReviewCreated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "auction_lot" ADD COLUMN "apiReviewFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The lots list filters by the marker, and the sales list counts it per sale.
CREATE INDEX "auction_lot_apiReviewAt_idx" ON "auction_lot"("apiReviewAt");
