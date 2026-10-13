-- Packing supplies used on a sale (#1898, ADR-0068 §7): a sale's own shipping cost is its postage
-- plus the supplies the parcel used, taken from stock FIFO.
--
-- ## A supply line on a sale
--
-- `sale_supply_line` names the supply and how many units the parcel used. `sale.shippingCost` stays
-- what it was — the typed amount — and is now the postage; *my shipping* is it plus these lines'
-- cost, summed by the app. A sale recorded before has no lines, so its typed amount is still all of
-- it, and nothing here touches it.
--
-- ## Where the units came from
--
-- `sale_supply_use` records the units a line took from one batch (`purchase_supply_line`). Each
-- costs its batch's unit cost, derived as the batch's own is, and going back to stock means going
-- back to that batch. A line holding fewer units than it used is short: the stock ran out, the
-- difference is uncosted, and the next purchase of the supply covers it.
--
-- Deleting a sale or its line returns the units (cascade). Deleting a batch cascades its uses too,
-- turning them into a shortfall that the app then covers from the supply's other batches.
--
-- The line's reference to its supply is `NO ACTION`, for the reason `purchase_supply_line`'s is: a
-- supply a sale used cannot be deleted, while a whole collection still deletes in one statement.

CREATE TABLE "sale_supply_line" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_supply_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_supply_line_quantity_positive" CHECK ("quantity" > 0)
);

CREATE INDEX "sale_supply_line_saleId_idx" ON "sale_supply_line"("saleId");
CREATE INDEX "sale_supply_line_supplyId_idx" ON "sale_supply_line"("supplyId");

ALTER TABLE "sale_supply_line" ADD CONSTRAINT "sale_supply_line_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sale_supply_line" ADD CONSTRAINT "sale_supply_line_supplyId_fkey"
    FOREIGN KEY ("supplyId") REFERENCES "packing_supply"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "sale_supply_use" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "sale_supply_use_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_supply_use_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "sale_supply_use_lineId_batchId_key" ON "sale_supply_use"("lineId", "batchId");
CREATE INDEX "sale_supply_use_batchId_idx" ON "sale_supply_use"("batchId");

ALTER TABLE "sale_supply_use" ADD CONSTRAINT "sale_supply_use_lineId_fkey"
    FOREIGN KEY ("lineId") REFERENCES "sale_supply_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sale_supply_use" ADD CONSTRAINT "sale_supply_use_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "purchase_supply_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
