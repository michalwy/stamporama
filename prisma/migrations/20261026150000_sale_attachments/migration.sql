-- The collector's own files about a sale (#2198): shipment photos, posting receipts — images and PDFs
-- kept with the sale, built as the conversation log's files are (#2150). A new table, so there is
-- nothing to carry over. The cascade from a sale drops the rows only; the bytes are deleted by the
-- domain (`sale-attachments.ts`).

CREATE TABLE "sale_attachment" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageBackend" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sale_attachment_saleId_createdAt_idx" ON "sale_attachment"("saleId", "createdAt");
CREATE INDEX "sale_attachment_collectionId_idx" ON "sale_attachment"("collectionId");

ALTER TABLE "sale_attachment" ADD CONSTRAINT "sale_attachment_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_attachment" ADD CONSTRAINT "sale_attachment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
