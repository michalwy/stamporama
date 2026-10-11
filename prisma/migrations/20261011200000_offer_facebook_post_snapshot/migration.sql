-- A Facebook offer's post as it was published (#1800): the template its lot was written from, the
-- note, and the figures, taken when the offer first goes up (Pending or Active) and read in place of
-- the live ones from then on, so a later template edit leaves a posted offer's text as it was posted.
-- Null until then, and again once the offer is back in Ready. Offers already up are frozen by the
-- app at start-up, not here: their text needs the display title and catalogue numbers, which SQL
-- cannot build.
ALTER TABLE "offer" ADD COLUMN "facebookPostSnapshot" JSONB;
