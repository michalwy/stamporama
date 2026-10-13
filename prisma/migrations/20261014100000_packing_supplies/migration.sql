-- Packing supplies (#1897, ADR-0068): envelopes, transport cards and the like, bought on purchase
-- orders, held in stock and costed FIFO.
--
-- ## The dictionary
--
-- `packing_supply` is a named entry per collection (*C6 envelope*, *transport card A6*) with nothing
-- else to set. Its price is never typed: it follows from the purchases it was bought on.
--
-- ## A supply line is a batch
--
-- `purchase_supply_line` is a line of a purchase order beside its lots and expenses (ADR-0009 §1),
-- naming the supply, how many units and the line price. Each line is one batch of that supply's
-- stock. Like the order's other lines it takes its share of the order's shipping by price, so the
-- batch's unit cost is (price + share) / quantity — derived, not stored, since the share moves
-- whenever the order's shipping or its other lines are restated.
--
-- On an opening balance the price is the batch's opening value and it is required there too (the
-- collector's call on 2026-10-14): a batch without a cost would leave every parcel packed from it
-- without one. An opening balance carries no shipping (`purchase_kind_shape`), so its unit cost is
-- simply price / quantity.
--
-- ## A supply that was bought cannot be deleted
--
-- The line's reference to its supply is `NO ACTION` rather than `RESTRICT`, so that deleting a whole
-- collection — which cascades to its supplies and its purchases in one statement — is checked at the
-- end of that statement, when nothing is left to point anywhere. The app checks first and says why;
-- the constraint is the backstop. A purchase takes its supply lines with it.

CREATE TABLE "packing_supply" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_supply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "packing_supply_collectionId_name_key" ON "packing_supply"("collectionId", "name");
CREATE INDEX "packing_supply_collectionId_idx" ON "packing_supply"("collectionId");

ALTER TABLE "packing_supply" ADD CONSTRAINT "packing_supply_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "purchase_supply_line" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(10, 2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_supply_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_supply_line_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "purchase_supply_line_price_non_negative" CHECK ("price" >= 0)
);

CREATE INDEX "purchase_supply_line_purchaseId_idx" ON "purchase_supply_line"("purchaseId");
CREATE INDEX "purchase_supply_line_supplyId_idx" ON "purchase_supply_line"("supplyId");

ALTER TABLE "purchase_supply_line" ADD CONSTRAINT "purchase_supply_line_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_supply_line" ADD CONSTRAINT "purchase_supply_line_supplyId_fkey"
    FOREIGN KEY ("supplyId") REFERENCES "packing_supply"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
