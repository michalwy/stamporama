-- The instance can send email to the collector (#1372; ADR-0059).
--
-- One table is the queue and the record: a row is queued by a feature, claimed by the in-process
-- worker, retried on a schedule of about an hour, and ends `sent` or `failed`. A `failed` row with
-- no `seenAt` is what the notification centre reports; opening Settings → Email sets `seenAt`.
-- No recipient column — mail only ever goes to the collection owner's account address.

CREATE TABLE "mail_message" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "mail_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_message_status_check"
      CHECK ("status" IN ('queued', 'sending', 'sent', 'failed'))
);

CREATE INDEX "mail_message_status_nextAttemptAt_idx" ON "mail_message"("status", "nextAttemptAt");

CREATE INDEX "mail_message_collectionId_status_idx" ON "mail_message"("collectionId", "status");

ALTER TABLE "mail_message"
  ADD CONSTRAINT "mail_message_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
