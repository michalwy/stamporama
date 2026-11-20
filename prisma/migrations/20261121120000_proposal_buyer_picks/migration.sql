-- #2601 (ADR-0075 §10): the buyer ticks the lots they want on the proposal's live page.
--
-- A pick is the lot's own: when the buyer ticked it, null while they have not. Cleared when the lot
-- leaves its proposal and when an offer joins one, so a pick never follows an offer elsewhere.
ALTER TABLE "offer" ADD COLUMN "proposalPickedAt" TIMESTAMP(3);

-- When the buyer last ticked or unticked a lot of the proposal — what *Buyer picked 3 lots · 2 h ago*
-- is timed from. Null while they never have.
ALTER TABLE "proposal" ADD COLUMN "buyerPicksChangedAt" TIMESTAMP(3);
