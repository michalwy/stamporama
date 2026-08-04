-- What an offer published through Allegro's API (#477) carries afterwards.
--
-- `allegroOfferId` is the listing's own identity on Allegro — the address every later write goes to,
-- activating a draft above all. It is not a second copy of what #467 matches on: that match runs off
-- the listing's `external.id` (the offer number) and off `url`, which is how an *observation* finds
-- its way back here. A draft has no public page and so no URL, which is precisely why the id has to
-- be recorded on its own.
--
-- `allegroPublishStatus` is what came back: `INACTIVE` (a draft), `ACTIVE` (published live), or
-- `PENDING` (Allegro answered 202 and its validation had not concluded before the request stopped
-- waiting). Both are null on every offer that has never been published through the API, and both are
-- written only by a publish Allegro accepted — never by hand.
ALTER TABLE "offer" ADD COLUMN "allegroOfferId" TEXT;
ALTER TABLE "offer" ADD COLUMN "allegroPublishStatus" TEXT;
