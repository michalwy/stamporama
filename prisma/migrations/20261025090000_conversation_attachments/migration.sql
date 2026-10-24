-- Attachments on conversation log entries (#2150, ADR-0073 §7): images and PDFs kept with the entry
-- they came with. A new table, so there is nothing to carry over. The cascade from an entry drops the
-- rows only; the bytes are deleted by the domain (`conversation-attachments.ts`).

CREATE TABLE "conversation_attachment" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageBackend" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_attachment_entryId_createdAt_idx" ON "conversation_attachment"("entryId", "createdAt");
CREATE INDEX "conversation_attachment_collectionId_idx" ON "conversation_attachment"("collectionId");

ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "conversation_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
