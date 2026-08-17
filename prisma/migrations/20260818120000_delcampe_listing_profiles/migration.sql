-- Delcampe listing profiles (#608; ADR-0034).
--
-- Everything an Easy Uploader row needs that is not a fact about the stamps: which of the seller's
-- own shipping models the row names, how long and how often the listing renews itself, whether any
-- of Delcampe's five paid promotions is bought, and the bid step the row is written with. Delcampe
-- is listed to by uploading a CSV rather than through an API — the REST path sits behind the paid
-- API Pass and is deliberately not taken — so the file's columns are the contract, and every one of
-- them has to be answerable before an export can be built (#610).
--
-- Held as one **named profile** owned by the Delcampe platform contact, the `allegro_listing_profile`
-- shape (#486): the second answer is real — heavier lots want the other shipping model — and the
-- whole set moves together when it does.
CREATE TABLE "delcampe_listing_profile" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- The **name** of a shipping model defined on Delcampe, and nothing else. Inverted from
    -- Allegro's rate set, which stores Allegro's id with the name as a label: the CSV carries the
    -- name itself, there is no id in reserve, and `GET /shippingModels` is API-Pass-only — so a
    -- model renamed there makes the upload fail and nothing here can find that out beforehand.
    "shippingModel" TEXT NOT NULL,
    -- Shop-stock renewal: 28 days, up to 99 times, promotions not re-bought. An auction wants an end
    -- date and its own defaults instead (#620).
    "renewDuration" INTEGER NOT NULL DEFAULT 28,
    "renewTotalCount" INTEGER NOT NULL DEFAULT 99,
    "hasRenewableOptions" BOOLEAN NOT NULL DEFAULT false,
    -- The five `option_*` columns, each a Y/N that costs money. All off today; they are stored
    -- because the file demands a value for every one, and a column silently written N by the
    -- exporter is a decision nobody could find later.
    "optionStrongTitle" BOOLEAN NOT NULL DEFAULT false,
    "optionBackgroundColor" BOOLEAN NOT NULL DEFAULT false,
    "optionBorderColor" BOOLEAN NOT NULL DEFAULT false,
    "optionListPromotion" BOOLEAN NOT NULL DEFAULT false,
    "optionHomepagePromotion" BOOLEAN NOT NULL DEFAULT false,
    -- `minimum_bid_step` is a threshold rule, not a constant: 0,01 was observed on cheap items and
    -- 0,10 on dearer ones. The threshold is a column rather than a constant because it was never
    -- confirmed against Delcampe, and a guess compiled into the exporter is one nobody can correct.
    "minBidStepThreshold" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    "minBidStepBelow" DECIMAL(10,2) NOT NULL DEFAULT 0.01,
    "minBidStepAtOrAbove" DECIMAL(10,2) NOT NULL DEFAULT 0.10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delcampe_listing_profile_pkey" PRIMARY KEY ("id")
);

-- The names *are* the pick list, so they are unique per platform (the shipping-method rule).
CREATE UNIQUE INDEX "delcampe_listing_profile_platformId_name_key"
    ON "delcampe_listing_profile"("platformId", "name");
CREATE INDEX "delcampe_listing_profile_collectionId_idx"
    ON "delcampe_listing_profile"("collectionId");
CREATE INDEX "delcampe_listing_profile_platformId_idx"
    ON "delcampe_listing_profile"("platformId");

ALTER TABLE "delcampe_listing_profile" ADD CONSTRAINT "delcampe_listing_profile_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A profile belongs to its platform: deleting the platform takes its profiles with it, exactly as it
-- takes its shipping methods (#468) and its Allegro profiles (#486).
ALTER TABLE "delcampe_listing_profile" ADD CONSTRAINT "delcampe_listing_profile_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The platform's default profile: one row of the list, not a flag on every row that something has to
-- keep exclusive. SET NULL, so deleting the default leaves the platform without one rather than
-- blocking the delete — "no default" is a state the settings tab states plainly.
ALTER TABLE "contact" ADD COLUMN "defaultDelcampeListingProfileId" TEXT;

CREATE INDEX "contact_defaultDelcampeListingProfileId_idx"
    ON "contact"("defaultDelcampeListingProfileId");

ALTER TABLE "contact" ADD CONSTRAINT "contact_defaultDelcampeListingProfileId_fkey"
    FOREIGN KEY ("defaultDelcampeListingProfileId") REFERENCES "delcampe_listing_profile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The per-offer override. Null — every existing offer, and the ordinary case for every new one —
-- means *the platform's default*. Naming a profile here is the escape hatch for the listing that
-- wants the other shipping model: a heavier lot, a bulkier package.
ALTER TABLE "offer" ADD COLUMN "delcampeListingProfileId" TEXT;

CREATE INDEX "offer_delcampeListingProfileId_idx" ON "offer"("delcampeListingProfileId");

ALTER TABLE "offer" ADD CONSTRAINT "offer_delcampeListingProfileId_fkey"
    FOREIGN KEY ("delcampeListingProfileId") REFERENCES "delcampe_listing_profile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
