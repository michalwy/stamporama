-- Add the offer's own listing title (#209): a stored, editable name independent of the label
-- derived from the offer's sets. Nullable — existing offers have no generated name and fall back
-- to the derived label until one is set.
ALTER TABLE "offer" ADD COLUMN "name" TEXT;
