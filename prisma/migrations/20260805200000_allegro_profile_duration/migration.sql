-- The listing duration a profile publishes with (#493).
--
-- Nullable and with no default: a profile written before this existed says nothing about duration,
-- and "nothing" is a real answer — the sale form is then left exactly as Allegro served it.
ALTER TABLE "allegro_listing_profile" ADD COLUMN "durationLimit" TEXT;
