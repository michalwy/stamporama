-- Add the optional listing date to offers (#257): the date a listing went live on the platform,
-- distinct from the record's createdAt. Nullable — existing offers have no recorded listing date.
ALTER TABLE "offer" ADD COLUMN "listingDate" DATE;
