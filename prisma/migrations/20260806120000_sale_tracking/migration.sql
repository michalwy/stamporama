-- Shipment tracking on a sale (#491), and the carrier dictionary the tracking link is built from.
--
-- Three parts, and the reason for the middle one is the whole design: a `shipping_method` belongs to
-- a **platform**, because postage is quoted by the marketplace the parcel sold on. A carrier is not
-- like that — the same Poczta Polska carries the Allegro parcel and the Delcampe one, and tracks
-- both at the same address. Keeping the tracking address on the method would mean typing it once per
-- marketplace and having the copies drift; so the carrier is a collection-level dictionary and a
-- method points at one.
CREATE TABLE "carrier" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- Where a consignment is looked up, `{code}` standing in for the tracking number. Null where the
    -- carrier has no tracking page worth linking to — the code is still recorded and shown, just not
    -- as a link. A stored template always carries the token; the domain refuses one that does not,
    -- since a link built by guessing where the number goes lands on somebody else's parcel.
    "trackingUrlTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_pkey" PRIMARY KEY ("id")
);

-- The name is the pick-list, as it is for shipping methods.
CREATE UNIQUE INDEX "carrier_collectionId_name_key" ON "carrier"("collectionId", "name");
CREATE INDEX "carrier_collectionId_idx" ON "carrier"("collectionId");

ALTER TABLE "carrier" ADD CONSTRAINT "carrier_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which carrier a shipping method posts with. Optional, and null on every existing method: nothing
-- knows who carried a parcel sent before this column existed, and guessing from a method's name
-- would be inventing a fact. RESTRICT, the detach-before-delete guard every other dictionary
-- reference carries.
ALTER TABLE "shipping_method" ADD COLUMN "carrierId" TEXT;

CREATE INDEX "shipping_method_carrierId_idx" ON "shipping_method"("carrierId");

ALTER TABLE "shipping_method" ADD CONSTRAINT "shipping_method_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tracking number itself, as the carrier stated it. Free text: every carrier numbers its
-- consignments its own way, and a format check here would reject the one the collector is holding.
--
-- Deliberately a code and not a link. The address is built on read from the carrier's template, so
-- a carrier that moves its tracking site is corrected once rather than on every sale it ever
-- carried — and a sale whose method names no carrier still keeps the number, shown as plain text.
ALTER TABLE "sale" ADD COLUMN "trackingCode" TEXT;
