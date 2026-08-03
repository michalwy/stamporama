-- Per-platform shipping methods (#468).
--
-- A shipping method is a dictionary row in the same sense as a stamp condition (#93) or a
-- certificate status (#94) — a short list the collector maintains and then picks from — except it
-- hangs off the **platform** rather than the collection: postage is quoted by the marketplace the
-- parcel was sold on, so "registered letter — 12 PLN" on Allegro says nothing about a Delcampe
-- sale. `collectionId` rides along beside `platformId` for scoping, exactly as the other
-- per-parent dictionaries carry it.
--
-- `cost` + `currency` are the method's **current** price. They are read when a method is picked on
-- a sale and copied onto that sale's own shipping fields (#206) from there; nothing here ever
-- reaches back into a sale already recorded when a carrier raises its rates.
CREATE TABLE "shipping_method" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_method_pkey" PRIMARY KEY ("id")
);

-- The names *are* the pick-list, so they are unique per platform: two "Courier" rows would be a
-- select nobody could choose from.
CREATE UNIQUE INDEX "shipping_method_platformId_name_key" ON "shipping_method"("platformId", "name");
CREATE INDEX "shipping_method_collectionId_idx" ON "shipping_method"("collectionId");
CREATE INDEX "shipping_method_platformId_idx" ON "shipping_method"("platformId");

ALTER TABLE "shipping_method" ADD CONSTRAINT "shipping_method_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A method belongs to its platform, so deleting the platform takes its price list with it. (A
-- platform with sales cannot be deleted at all — `sale.platformId` is RESTRICT.)
ALTER TABLE "shipping_method" ADD CONSTRAINT "shipping_method_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The sale side: which method the buyer chose, and what it was called when they did.
--
-- Both columns are written together. The FK is the live link back to the dictionary row (RESTRICT,
-- the same detach-before-delete guard every other dictionary reference carries), while the name is
-- a **snapshot**: the dictionary is a price list the collector re-prices and renames as the
-- carriers do, and a sale must keep saying which service was actually bought. A one-off *Custom*
-- method has no dictionary row at all and stores the name alone.
--
-- Both null on every existing sale, which is right: a sale recorded before the dictionary existed
-- has a shipping cost and no statement about how it was sent, and inventing one would be inventing
-- a fact. Its cost stays exactly as entered.
ALTER TABLE "sale" ADD COLUMN "shippingMethodId" TEXT;
ALTER TABLE "sale" ADD COLUMN "shippingMethodName" TEXT;

CREATE INDEX "sale_shippingMethodId_idx" ON "sale"("shippingMethodId");

ALTER TABLE "sale" ADD CONSTRAINT "sale_shippingMethodId_fkey"
    FOREIGN KEY ("shippingMethodId") REFERENCES "shipping_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
