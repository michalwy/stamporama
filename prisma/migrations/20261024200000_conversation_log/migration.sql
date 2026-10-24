-- The conversation log (#2149, ADR-0073): entries of what was said with a buyer, each on a contact
-- and optionally on one of that contact's sales. A new table, so there is nothing to carry over.

CREATE TABLE "conversation_entry" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "saleId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "quote" TEXT,
    "url" TEXT,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_entry_collectionId_occurredAt_idx" ON "conversation_entry"("collectionId", "occurredAt");
CREATE INDEX "conversation_entry_contactId_occurredAt_idx" ON "conversation_entry"("contactId", "occurredAt");
CREATE INDEX "conversation_entry_saleId_idx" ON "conversation_entry"("saleId");

ALTER TABLE "conversation_entry" ADD CONSTRAINT "conversation_entry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_entry" ADD CONSTRAINT "conversation_entry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_entry" ADD CONSTRAINT "conversation_entry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
