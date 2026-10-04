-- How a ceiling set apart from the bid was reached (#1627).
--
-- The agent API sets a lot's ceiling from `recommend_bid`, and the collector wants the reasoning kept
-- beside the figure — which condition and certificate the recommendation assumed — so a ceiling read
-- weeks later can be argued with. The note belongs to the ceiling **set apart** (`maxBid`, #1515):
-- it is written with it, and any other write that changes or clears that ceiling clears the note, so
-- a note never explains a figure it was not written for. Every existing lot has none.
ALTER TABLE "auction_lot" ADD COLUMN "ceilingNote" TEXT;
