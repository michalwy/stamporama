-- Realised prices from other people's auctions (#1633; ADR-0063, amending ADR-0022).
--
-- A **price observation** is a market fact — *Mi 5, MNH, hammered 120 EUR at Köhler on 2024-03-14* —
-- recorded without inventing a lot or a purchase. It is never either: it has no sale, no bid, no
-- outcome, and nothing on the watchlist, in exposure or in purchase history reads this table.
--
-- **Restrict on the vocabulary and the contacts, cascade on the stamp and the collection**, the
-- `auction_lot_line` arrangement except for the stamp: a lot line is part of a bidding record that
-- outlives the catalogue, while an observation is a fact about one catalogue position and about
-- nothing else, so deleting the stamp takes it along.
--
-- The CHECKs are the shapes the domain layer already refuses, kept at the database so an agent API
-- write (#1635) meets the same wall: a basis is one of two words, a price is positive and a premium is
-- not negative.
CREATE TABLE "price_observation" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "conditionId" TEXT,
    "certificateStatusId" TEXT,
    "certificateUncertain" BOOLEAN NOT NULL DEFAULT false,
    "formatId" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceBasis" TEXT NOT NULL,
    "premiumPercent" DECIMAL(5,2),
    "premiumFixed" DECIMAL(10,2),
    "soldOn" DATE NOT NULL,
    "fxRateToBase" DECIMAL(65,30),
    "platformId" TEXT NOT NULL,
    "auctionHouseId" TEXT,
    "auctionName" TEXT,
    "lotNo" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_observation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_observation_basis" CHECK ("priceBasis" IN ('hammer', 'all_in')),
    CONSTRAINT "price_observation_price_positive" CHECK ("price" > 0),
    CONSTRAINT "price_observation_premium_percent_range" CHECK ("premiumPercent" IS NULL OR "premiumPercent" >= 0),
    CONSTRAINT "price_observation_premium_fixed_range" CHECK ("premiumFixed" IS NULL OR "premiumFixed" >= 0)
);

CREATE INDEX "price_observation_collectionId_idx" ON "price_observation"("collectionId");
CREATE INDEX "price_observation_stampId_idx" ON "price_observation"("stampId");
CREATE INDEX "price_observation_conditionId_idx" ON "price_observation"("conditionId");
CREATE INDEX "price_observation_certificateStatusId_idx" ON "price_observation"("certificateStatusId");
CREATE INDEX "price_observation_formatId_idx" ON "price_observation"("formatId");
CREATE INDEX "price_observation_platformId_idx" ON "price_observation"("platformId");
CREATE INDEX "price_observation_auctionHouseId_idx" ON "price_observation"("auctionHouseId");

ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_certificateStatusId_fkey" FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "stamp_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_auctionHouseId_fkey" FOREIGN KEY ("auctionHouseId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
