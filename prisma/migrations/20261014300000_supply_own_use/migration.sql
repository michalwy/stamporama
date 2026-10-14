-- Packing supplies taken out of stock without a sale (#1900, ADR-0068 §8) — transport cards the
-- collector keeps stamps in at home, which never pass through a sale.
--
-- ## An own use
--
-- `supply_own_use` is a quantity of one supply, the day it was used and an optional note. Its units
-- leave stock FIFO under the same rule as a sale's supply line, and its cost is charged to no sale
-- and no copy: the Supplies screen states it as a cost of its own, by period.
--
-- ## Where the units came from
--
-- `supply_own_use_take` is `sale_supply_use`'s twin: the units an own use took from one batch
-- (`purchase_supply_line`), each at that batch's unit cost, derived on read. Deleting the use returns
-- them (cascade); deleting the batch cascades its takes, and the app covers the use from the supply's
-- other batches where it can.
--
-- The reference to the supply is `NO ACTION`, for `purchase_supply_line`'s reason; the collection
-- cascades, so a whole collection still deletes in one statement.

CREATE TABLE "supply_own_use" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "usedAt" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_own_use_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supply_own_use_quantity_positive" CHECK ("quantity" > 0)
);

CREATE INDEX "supply_own_use_collectionId_usedAt_idx" ON "supply_own_use"("collectionId", "usedAt");
CREATE INDEX "supply_own_use_supplyId_idx" ON "supply_own_use"("supplyId");

ALTER TABLE "supply_own_use" ADD CONSTRAINT "supply_own_use_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supply_own_use" ADD CONSTRAINT "supply_own_use_supplyId_fkey"
    FOREIGN KEY ("supplyId") REFERENCES "packing_supply"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "supply_own_use_take" (
    "id" TEXT NOT NULL,
    "useId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "supply_own_use_take_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supply_own_use_take_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "supply_own_use_take_useId_batchId_key" ON "supply_own_use_take"("useId", "batchId");
CREATE INDEX "supply_own_use_take_batchId_idx" ON "supply_own_use_take"("batchId");

ALTER TABLE "supply_own_use_take" ADD CONSTRAINT "supply_own_use_take_useId_fkey"
    FOREIGN KEY ("useId") REFERENCES "supply_own_use"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supply_own_use_take" ADD CONSTRAINT "supply_own_use_take_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "purchase_supply_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
