-- An intake document's note (#2378): one plain, multi-line remark the collector keeps on a purchase,
-- a trade's intake or an opening balance — what was agreed with the seller, what is still missing
-- from the parcel, where the lot came from. Private: nothing that leaves the app reads it.
--
-- Null when there is none; an emptied note is stored as null, never as an empty string.
ALTER TABLE "purchase" ADD COLUMN "note" TEXT;
