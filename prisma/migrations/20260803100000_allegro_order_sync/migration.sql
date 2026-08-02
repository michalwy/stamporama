-- Allegro sold-listing sync (#467; ADR-0024): where the sync has got to, the order lines it has
-- observed, and the snapshot of the account's own active listings the "ended without selling"
-- reading is an absence from. Nothing here is a financial record — creating the `Sale` stays an
-- explicit act (#463).

-- CreateTable
CREATE TABLE "allegro_sync_state" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "orderCursor" TEXT,
    "ordersSyncedAt" TIMESTAMP(3),
    "listingsSweptAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allegro_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allegro_order_line" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "platformOfferId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "boughtAt" TIMESTAMP(3) NOT NULL,
    "orderStatus" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "offerId" TEXT,
    "matchedBy" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegro_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allegro_listing" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformOfferId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "endingAt" TIMESTAMP(3),
    "available" INTEGER,
    "sold" INTEGER,
    "offerId" TEXT,
    "matchedBy" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allegro_listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allegro_sync_state_collectionId_key" ON "allegro_sync_state"("collectionId");

-- CreateIndex
CREATE INDEX "allegro_order_line_collectionId_boughtAt_idx" ON "allegro_order_line"("collectionId", "boughtAt");

-- CreateIndex
CREATE INDEX "allegro_order_line_offerId_idx" ON "allegro_order_line"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "allegro_order_line_collectionId_orderId_lineItemId_key" ON "allegro_order_line"("collectionId", "orderId", "lineItemId");

-- CreateIndex
CREATE INDEX "allegro_listing_offerId_idx" ON "allegro_listing"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "allegro_listing_collectionId_platformOfferId_key" ON "allegro_listing"("collectionId", "platformOfferId");

-- AddForeignKey
ALTER TABLE "allegro_sync_state" ADD CONSTRAINT "allegro_sync_state_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allegro_order_line" ADD CONSTRAINT "allegro_order_line_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allegro_order_line" ADD CONSTRAINT "allegro_order_line_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allegro_listing" ADD CONSTRAINT "allegro_listing_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allegro_listing" ADD CONSTRAINT "allegro_listing_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
