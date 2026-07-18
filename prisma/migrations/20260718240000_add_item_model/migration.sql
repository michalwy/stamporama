-- Per-copy physical holdings model (ADR-0007, #97).
-- One `item` row per physical copy owned; no quantity field. `stampId` links to a
-- stamp at any tree level (base = unknown variant, variant row = identified).
-- `item_variant_history` records in-place re-pointing of `stampId` on refinement.

CREATE TABLE "item" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "certificateStatusId" TEXT,
    "inCollection" BOOLEAN NOT NULL DEFAULT true,
    "forSale" BOOLEAN NOT NULL DEFAULT false,
    "forTrade" BOOLEAN NOT NULL DEFAULT false,
    "acquisitionSource" TEXT,
    "acquiredDay" INTEGER,
    "acquiredMonth" INTEGER,
    "acquiredYear" INTEGER,
    "purchasePrice" DECIMAL(10,2),
    "purchaseCurrency" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "item_collectionId_idx" ON "item"("collectionId");
CREATE INDEX "item_stampId_idx" ON "item"("stampId");
CREATE INDEX "item_conditionId_idx" ON "item"("conditionId");

ALTER TABLE "item" ADD CONSTRAINT "item_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item" ADD CONSTRAINT "item_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item" ADD CONSTRAINT "item_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item" ADD CONSTRAINT "item_certificateStatusId_fkey"
    FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "item_variant_history" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromStampId" TEXT NOT NULL,
    "toStampId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "item_variant_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "item_variant_history_itemId_idx" ON "item_variant_history"("itemId");

ALTER TABLE "item_variant_history" ADD CONSTRAINT "item_variant_history_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_variant_history" ADD CONSTRAINT "item_variant_history_fromStampId_fkey"
    FOREIGN KEY ("fromStampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_variant_history" ADD CONSTRAINT "item_variant_history_toStampId_fkey"
    FOREIGN KEY ("toStampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
