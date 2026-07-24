-- "In active bidding" (#215): an offer state independent of `state`/`sold`, for auction platforms
-- where a bid commits the collector before the sale is actually recorded. Setting it flags every
-- other active offer holding the same copies as needing action (same mechanism as an actual sale
-- collision, #167), and it can be freely reverted if the auction doesn't close.
ALTER TABLE "offer" ADD COLUMN "inActiveBidding" BOOLEAN NOT NULL DEFAULT false;
