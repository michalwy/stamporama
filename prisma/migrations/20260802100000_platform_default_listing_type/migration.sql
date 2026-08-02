-- A platform's default listing type (#449), the listing-format counterpart of `defaultOfferPrice`
-- (#362): a marketplace one only ever auctions on should not have that answered per listing.
--
-- Read at creation and then owned by the offer, never seeded-and-followed: changing the platform's
-- preference later cannot re-describe a listing already posted, exactly as with the default price.
--
-- Nullable, and null is "no preference" rather than a stored `fixed`. The two behave identically
-- today, so nothing has to be written to leave a platform alone — which is why every existing
-- contact is left untouched here.
ALTER TABLE "contact" ADD COLUMN "defaultListingType" TEXT;
