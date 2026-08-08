-- Single photos before a collage while the platform's limit has room (#521).
--
-- The photo planner (#309) chunked every run of single-copy sets into collages regardless of how
-- many photos the platform accepts. A collage is a compromise — a way to fit more stamps than there
-- are slots — so with slots to spare the stamps are better shown one per image. The flag says
-- whether this listing spends its `maxPhotos` budget that way; off is #309's original grouping.
--
-- Seeded onto every new offer from its platform, exactly as `photoSides` and the label templates
-- are (#308), so changing the platform never touches a listing already prepared.
ALTER TABLE "contact" ADD COLUMN "photoPreferSingles" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "offer" ADD COLUMN "photoPreferSingles" BOOLEAN NOT NULL DEFAULT true;

-- Offers whose photos have **already been rendered** keep the old grouping. The images may be live
-- on a marketplace right now, and turning a stored plan out of date as a side effect of an upgrade
-- is precisely what seeding-rather-than-reading exists to prevent (#315). An offer with nothing
-- rendered yet has no such history, so it takes the new default.
UPDATE "offer" SET "photoPreferSingles" = false
WHERE EXISTS (SELECT 1 FROM "offer_photo_entry" e WHERE e."offerId" = "offer"."id");
