-- Per-collection Contact entity — a lightweight address book of everyone the
-- collector deals with (sellers, buyers, exchange partners, auction houses,
-- platforms). Foundation for acquisition-source autocomplete (#103b) and the
-- future sales/trade layer. See ADR-0008 and #107.
--
-- Roles are independent, combinable boolean columns (a single contact can hold
-- several roles at once), mirroring the disposition flags on `item` (ADR-0007 §4).
-- `create` may set no roles at all (create-on-type produces a role-less contact).
-- `name` is unique per collection.

CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "buyer" BOOLEAN NOT NULL DEFAULT false,
    "seller" BOOLEAN NOT NULL DEFAULT false,
    "exchangePartner" BOOLEAN NOT NULL DEFAULT false,
    "auctionHouse" BOOLEAN NOT NULL DEFAULT false,
    "platform" BOOLEAN NOT NULL DEFAULT false,
    "other" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_collectionId_name_key" ON "contact"("collectionId", "name");
CREATE INDEX "contact_collectionId_idx" ON "contact"("collectionId");

ALTER TABLE "contact" ADD CONSTRAINT "contact_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
