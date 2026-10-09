-- Quick buys past their platform's refresh threshold, and reposting them on the same offer (#1718).
--
-- A Facebook post a few days old is seen by nobody, and a Delcampe listing sinks; the collector
-- deletes it and posts it again. Three things make that visible and recordable:
--
-- * **The threshold**, `refreshQuickBuysAfterDays`, on the platform contact and — for Facebook,
--   whose settings live there since #1661 — on `facebook_defaults` and on each group, which follows
--   the defaults unless it lists the key in `customSettings`. Null everywhere: never, which is what
--   every platform was until now.
-- * **When the offer was last posted**, `offer.lastPostedAt`. `listingDate` stays the first listing.
--   Null on every existing offer: none has been reposted, so the count runs from the listing date.
-- * **The earlier postings**, one `offer_posting` row per link replaced, with the dates it was up.

ALTER TABLE "contact"
    ADD COLUMN "refreshQuickBuysAfterDays" INTEGER;

ALTER TABLE "facebook_defaults"
    ADD COLUMN "refreshQuickBuysAfterDays" INTEGER;

ALTER TABLE "facebook_group"
    ADD COLUMN "refreshQuickBuysAfterDays" INTEGER;

ALTER TABLE "offer"
    ADD COLUMN "lastPostedAt" TIMESTAMP(3);

CREATE TABLE "offer_posting" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "url" TEXT,
    "postedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_posting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offer_posting_offerId_idx" ON "offer_posting"("offerId");

ALTER TABLE "offer_posting"
    ADD CONSTRAINT "offer_posting_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
