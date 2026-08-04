-- Allegro listing profiles (#486; ADR-0025).
--
-- The seller-side settings every published Allegro listing needs and no offer has any notion of:
-- the shipping rate set and handling time, the after-sales services, where the parcel is sent from,
-- and what the listing promises about invoicing. All of it is the collector's *account*
-- configuration rather than anything about a stamp — identical for a 1918 Polish issue and a modern
-- block, changing when they move house or add a courier — so it is held once, as a named profile on
-- the Allegro platform contact, instead of on every listing.
--
-- The three dictionary references are **Allegro's own ids**, naming things that exist only in the
-- collector's Allegro account. The `*Name` beside each is a snapshot for display, written from what
-- the account said at save time: the id is the truth, the name is a label a screen can show without
-- a live call. Nothing re-validates them here — the editor reads the account live, and #477's
-- publish is where a rate set deleted on Allegro actually matters.
CREATE TABLE "allegro_listing_profile" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shippingRatesId" TEXT NOT NULL,
    "shippingRatesName" TEXT,
    "handlingTime" TEXT NOT NULL DEFAULT 'PT24H',
    "returnPolicyId" TEXT,
    "returnPolicyName" TEXT,
    "impliedWarrantyId" TEXT,
    "impliedWarrantyName" TEXT,
    "locationCountryCode" TEXT NOT NULL DEFAULT 'PL',
    "locationCity" TEXT NOT NULL,
    "locationPostCode" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL DEFAULT 'NO_INVOICE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegro_listing_profile_pkey" PRIMARY KEY ("id")
);

-- The names *are* the pick-list, so they are unique per platform (the shipping-method rule).
CREATE UNIQUE INDEX "allegro_listing_profile_platformId_name_key"
    ON "allegro_listing_profile"("platformId", "name");
CREATE INDEX "allegro_listing_profile_collectionId_idx" ON "allegro_listing_profile"("collectionId");
CREATE INDEX "allegro_listing_profile_platformId_idx" ON "allegro_listing_profile"("platformId");

ALTER TABLE "allegro_listing_profile" ADD CONSTRAINT "allegro_listing_profile_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A profile belongs to its platform, so deleting the platform takes its profiles with it — exactly
-- as it takes its shipping methods (#468).
ALTER TABLE "allegro_listing_profile" ADD CONSTRAINT "allegro_listing_profile_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The platform's default profile: one row of the list, not a flag on every row that something has
-- to keep exclusive — the `contact.defaultCollageTemplateId` shape (#308), for the same reason.
--
-- SET NULL, not RESTRICT: deleting the default must leave the platform without one rather than being
-- blocked, and "no default" is a state the settings tab states plainly.
ALTER TABLE "contact" ADD COLUMN "defaultAllegroListingProfileId" TEXT;

CREATE INDEX "contact_defaultAllegroListingProfileId_idx"
    ON "contact"("defaultAllegroListingProfileId");

ALTER TABLE "contact" ADD CONSTRAINT "contact_defaultAllegroListingProfileId_fkey"
    FOREIGN KEY ("defaultAllegroListingProfileId") REFERENCES "allegro_listing_profile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The per-offer override. Null — which is every existing offer, and the ordinary case for every new
-- one — means *the platform's default*, which is what almost every listing wants. Naming a profile
-- here is the escape hatch for the listing that does not: a heavier package wanting a different rate
-- set, a run posted while away from home.
ALTER TABLE "offer" ADD COLUMN "allegroListingProfileId" TEXT;

CREATE INDEX "offer_allegroListingProfileId_idx" ON "offer"("allegroListingProfileId");

ALTER TABLE "offer" ADD CONSTRAINT "offer_allegroListingProfileId_fkey"
    FOREIGN KEY ("allegroListingProfileId") REFERENCES "allegro_listing_profile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
