-- The Allegro category and parameters a listing goes out in, moved onto the offer (#494).
--
-- They were worked out inside the publish dialog (#477), which made them unreachable from the other
-- way a listing reaches Allegro — the Assistant filling its sale form (#493). A value each path
-- resolves for itself is a value the two eventually disagree about, so both now read this.
--
-- Filled in automatically when an offer gains its first copy, from the learned register (#488) and
-- then from Allegro's own guess at the title; corrected in place on the offer's Allegro card, and
-- re-matched only by an explicit ↻. Null on every offer that is not on the Allegro platform, and on
-- every one that predates this.
--
-- `allegroCategorySource` is `learned` | `allegro` | `manual` and `allegroCategoryMatchedOn` is the
-- sentence saying what it was matched on: neither gates anything, they are what lets the card say
-- where a value came from. `allegroCategoryParameters` holds `[{ parameterId, parameterName, value }]`
-- for the **offer**-section parameters only.
ALTER TABLE "offer" ADD COLUMN "allegroCategoryId" TEXT;
ALTER TABLE "offer" ADD COLUMN "allegroCategoryName" TEXT;
ALTER TABLE "offer" ADD COLUMN "allegroCategoryPath" TEXT;
ALTER TABLE "offer" ADD COLUMN "allegroCategorySource" TEXT;
ALTER TABLE "offer" ADD COLUMN "allegroCategoryMatchedOn" TEXT;
ALTER TABLE "offer" ADD COLUMN "allegroCategoryParameters" JSONB;
