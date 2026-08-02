-- The Allegro order gets a header of its own (#467; ADR-0024).
--
-- The buyer, the order status and the total the buyer paid are facts about the *order*, and one
-- order routinely carries several of the collector's listings — so they move out of the line rows
-- that were repeating them into `allegro_order`, which the lines now point at.
--
-- Existing lines cannot be assigned an order they never recorded, so they are cleared. Nothing is
-- lost: every row in this table is an observation the next sync pass rewrites from Allegro, and the
-- worklist is a derivation over them rather than a record anybody has edited.
DELETE FROM "allegro_order_line";

-- CreateTable
CREATE TABLE "allegro_order" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "boughtAt" TIMESTAMP(3) NOT NULL,
    "buyerLogin" TEXT,
    "buyerName" TEXT,
    "totalPaid" DECIMAL(10,2),
    "currency" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegro_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allegro_order_collectionId_orderId_key" ON "allegro_order"("collectionId", "orderId");

-- CreateIndex
CREATE INDEX "allegro_order_collectionId_boughtAt_idx" ON "allegro_order"("collectionId", "boughtAt");

-- AddForeignKey
ALTER TABLE "allegro_order" ADD CONSTRAINT "allegro_order_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "allegro_order_line_collectionId_orderId_lineItemId_key";

-- DropIndex
DROP INDEX "allegro_order_line_collectionId_boughtAt_idx";

-- AlterTable
ALTER TABLE "allegro_order_line" DROP COLUMN "orderId",
DROP COLUMN "orderStatus",
DROP COLUMN "paymentStatus",
DROP COLUMN "firstSeenAt",
ADD COLUMN "allegroOrderId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "allegro_order_line_allegroOrderId_lineItemId_key" ON "allegro_order_line"("allegroOrderId", "lineItemId");

-- CreateIndex
CREATE INDEX "allegro_order_line_collectionId_idx" ON "allegro_order_line"("collectionId");

-- AddForeignKey
ALTER TABLE "allegro_order_line" ADD CONSTRAINT "allegro_order_line_allegroOrderId_fkey" FOREIGN KEY ("allegroOrderId") REFERENCES "allegro_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
