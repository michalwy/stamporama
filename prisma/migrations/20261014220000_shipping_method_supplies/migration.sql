-- A shipping method's usual packing supplies (#1899, ADR-0068 §8): a registered letter goes in a C6
-- envelope with two transport cards, so the method can say so, and choosing it on a sale fills the
-- sale's supply lines in.
--
-- `shipping_method_supply` is a default and nothing more: it names a supply and a quantity per
-- method, and is read only when a sale's method is chosen or changed. A sale's own lines
-- (`sale_supply_line`) stay what the parcel used, editable there, and no change to a method's list
-- reaches a sale already recorded.
--
-- One row per supply per method — the quantity says how many. Both references cascade: a method's
-- list goes with the method, and a supply deleted (which the app allows only for one nothing has
-- bought or used) leaves the lists it was on.

CREATE TABLE "shipping_method_supply" (
    "id" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "shipping_method_supply_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipping_method_supply_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "shipping_method_supply_methodId_supplyId_key"
    ON "shipping_method_supply"("methodId", "supplyId");
CREATE INDEX "shipping_method_supply_supplyId_idx" ON "shipping_method_supply"("supplyId");

ALTER TABLE "shipping_method_supply" ADD CONSTRAINT "shipping_method_supply_methodId_fkey"
    FOREIGN KEY ("methodId") REFERENCES "shipping_method"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipping_method_supply" ADD CONSTRAINT "shipping_method_supply_supplyId_fkey"
    FOREIGN KEY ("supplyId") REFERENCES "packing_supply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
