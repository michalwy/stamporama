-- Sales data model (ADR-0012, #162). The platform-agnostic package the collector
-- composes (`lot`, recursive: unit vs quantity), its per-platform listings (`offer`),
-- and the sale transaction (`sale` / `sale_line` / `sale_line_item`). No behavior yet —
-- schema + migration only; lot composition, offers, and the sale flow land in #164+.
--
-- Derived states (`sold` / `partially-sold` on a lot, the offers "to-close" flag) are
-- intentionally NOT columns — they are computed from item/sub-lot state (ADR-0012 §1/§5).
-- The recursive-lot invariants (unit lots hold items, quantity lots hold sub-lots) are
-- domain guards, not DB constraints. The one invariant expressible in the DB — no double
-- sale — is the unique on `sale_line_item.itemId`.

-- Lot: recursive sale package -----------------------------------------------
CREATE TABLE "lot" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lot_collectionId_idx" ON "lot"("collectionId");

ALTER TABLE "lot" ADD CONSTRAINT "lot_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Item N:M Lot (unit-lot membership) ----------------------------------------
CREATE TABLE "lot_item" (
    "lotId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "lot_item_pkey" PRIMARY KEY ("lotId", "itemId")
);

CREATE INDEX "lot_item_itemId_idx" ON "lot_item"("itemId");

ALTER TABLE "lot_item" ADD CONSTRAINT "lot_item_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_item" ADD CONSTRAINT "lot_item_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quantity-lot ↔ sub-lot self relation (N:M) --------------------------------
CREATE TABLE "lot_sub_lot" (
    "parentLotId" TEXT NOT NULL,
    "childLotId" TEXT NOT NULL,

    CONSTRAINT "lot_sub_lot_pkey" PRIMARY KEY ("parentLotId", "childLotId")
);

CREATE INDEX "lot_sub_lot_childLotId_idx" ON "lot_sub_lot"("childLotId");

ALTER TABLE "lot_sub_lot" ADD CONSTRAINT "lot_sub_lot_parentLotId_fkey"
    FOREIGN KEY ("parentLotId") REFERENCES "lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_sub_lot" ADD CONSTRAINT "lot_sub_lot_childLotId_fkey"
    FOREIGN KEY ("childLotId") REFERENCES "lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Offer: a lot listed on one platform ---------------------------------------
CREATE TABLE "offer" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "url" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offer_collectionId_idx" ON "offer"("collectionId");
CREATE INDEX "offer_lotId_idx" ON "offer"("lotId");
CREATE INDEX "offer_platformId_idx" ON "offer"("platformId");

ALTER TABLE "offer" ADD CONSTRAINT "offer_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer" ADD CONSTRAINT "offer_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer" ADD CONSTRAINT "offer_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sale: the transaction header ----------------------------------------------
CREATE TABLE "sale" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "soldAt" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "fxRateToBase" DECIMAL(65,30),
    "buyerHandling" DECIMAL(10,2),
    "shippingCost" DECIMAL(10,2),
    "commission" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sale_collectionId_idx" ON "sale"("collectionId");
CREATE INDEX "sale_platformId_idx" ON "sale"("platformId");

ALTER TABLE "sale" ADD CONSTRAINT "sale_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale" ADD CONSTRAINT "sale_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sale line: the lot/sub-lot sold on a sale ---------------------------------
CREATE TABLE "sale_line" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "offerId" TEXT,
    "lotId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "sale_line_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sale_line_saleId_idx" ON "sale_line"("saleId");
CREATE INDEX "sale_line_offerId_idx" ON "sale_line"("offerId");
CREATE INDEX "sale_line_lotId_idx" ON "sale_line"("lotId");

ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sale line ↔ Item: the exact copies that left; unique itemId = no double sale
CREATE TABLE "sale_line_item" (
    "saleLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "sale_line_item_pkey" PRIMARY KEY ("saleLineId", "itemId")
);

CREATE UNIQUE INDEX "sale_line_item_itemId_key" ON "sale_line_item"("itemId");

ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_saleLineId_fkey"
    FOREIGN KEY ("saleLineId") REFERENCES "sale_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
