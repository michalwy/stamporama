-- Closing a sale's last open lot asks whether to settle or close the sale too (#1954).
--
-- The question is asked once per sale: `finishAskedAt` is when the collector answered it — settle,
-- close or not now — and null means it has not been asked yet. Whether a sale is ready to be asked
-- is not stored; it is read off its lots. Every existing sale starts unasked, so one already waiting
-- with all its lots closed asks the next time it is opened.

ALTER TABLE "auction_sale" ADD COLUMN "finishAskedAt" TIMESTAMP(3);
