-- Whether a profile's listings are automatically re-listed when they run out (#493).
--
-- A boolean rather than a nullable one: it is a way of selling the profile decides either way, so
-- an unticked box is an answer and not the absence of one. `false` is what every profile written
-- before this said by saying nothing — Allegro's own form serves it unticked.
ALTER TABLE "allegro_listing_profile" ADD COLUMN "autoRepublish" BOOLEAN NOT NULL DEFAULT false;
