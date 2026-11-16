-- Copies an assistant adds to a purchase lot, or corrects there, carry a *to review* marker (#2551).
--
-- The agent API may now fill an open lot with copies (adding them, and correcting or removing ones
-- still ordered). What it writes waits for the collector the way auction lots and sales it writes do
-- (#1626, #1948): every such write sets the marker, and only the collector's *Confirm* on the
-- purchase's screen clears it. Editing the copy in the app leaves it standing. The same three
-- columns as `auction_lot`'s, read and accumulated by the same pure code (`auction-review.ts`):
--
--   apiReviewAt       the latest API write since the last confirm; NULL means no marker at all
--   apiReviewCreated  the API added the copy (rather than only correcting one)
--   apiReviewFields   what the API corrected — stamp, condition, format — accumulated until confirmed
--
-- No copy was ever written through the API before this, so every row starts unmarked.
ALTER TABLE "item" ADD COLUMN "apiReviewAt" TIMESTAMP(3);
ALTER TABLE "item" ADD COLUMN "apiReviewCreated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "item" ADD COLUMN "apiReviewFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
