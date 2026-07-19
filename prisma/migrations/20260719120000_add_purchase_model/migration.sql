-- Purchase data model (ADR-0009, #118). Introduces the three-level purchase
-- structure (`purchase` header, `purchase_lot` inventory line, `purchase_expense`
-- non-inventory line) and extends `item` with the acquisition link (`lotId`), the
-- physical delivery axis (`deliveryState`), and the base-currency cost-basis snapshot
-- (`costBasis`).
--
-- The flat acquisition/cost fields on `item` from ADR-0007 (`contactId`,
-- `acquiredDate`, `purchasePrice`, `purchaseCurrency`) are DROPPED: supplier, date,
-- and price now live on `purchase`/`purchase_lot`. Demo/empty data only, so no
-- backfill into the new model — existing copies keep a null cost-basis and default
-- `delivered` delivery state.

-- Purchase header ------------------------------------------------------------
CREATE TABLE "purchase" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "contactId" TEXT,
    "purchasedAt" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "fxRateToBase" DECIMAL(65,30),
    "shippingCost" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_collectionId_idx" ON "purchase"("collectionId");
CREATE INDEX "purchase_contactId_idx" ON "purchase"("contactId");

ALTER TABLE "purchase" ADD CONSTRAINT "purchase_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Purchase inventory line ----------------------------------------------------
CREATE TABLE "purchase_lot" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "purchase_lot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_lot_purchaseId_idx" ON "purchase_lot"("purchaseId");

ALTER TABLE "purchase_lot" ADD CONSTRAINT "purchase_lot_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Purchase non-inventory line ------------------------------------------------
CREATE TABLE "purchase_expense" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "purchase_expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_expense_purchaseId_idx" ON "purchase_expense"("purchaseId");

ALTER TABLE "purchase_expense" ADD CONSTRAINT "purchase_expense_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Item: drop the flat acquisition/cost fields (superseded by the purchase model) ---
ALTER TABLE "item" DROP CONSTRAINT "item_contactId_fkey";
DROP INDEX "item_contactId_idx";
ALTER TABLE "item" DROP COLUMN "contactId";
ALTER TABLE "item" DROP COLUMN "acquiredDate";
ALTER TABLE "item" DROP COLUMN "purchasePrice";
ALTER TABLE "item" DROP COLUMN "purchaseCurrency";

-- Item: add the acquisition link, delivery axis, and cost-basis snapshot ----------
ALTER TABLE "item" ADD COLUMN "lotId" TEXT;
ALTER TABLE "item" ADD COLUMN "deliveryState" TEXT NOT NULL DEFAULT 'delivered';
ALTER TABLE "item" ADD COLUMN "costBasis" DECIMAL(10,2);

CREATE INDEX "item_lotId_idx" ON "item"("lotId");

ALTER TABLE "item" ADD CONSTRAINT "item_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "purchase_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
