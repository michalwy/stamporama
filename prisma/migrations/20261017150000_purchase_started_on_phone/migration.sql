-- A purchase started on the phone (#2006, ADR-0072): the mark *started on the phone — to complete*,
-- and the stamps the phone noted as bought.
--
-- `toCompleteSince` is when the phone started the purchase, and null once the collector says *Done
-- at the desk* — and for every purchase entered at the desk, which is every row this migration
-- finds. A purchase only: an opening balance is never started on the phone.

ALTER TABLE "purchase" ADD COLUMN "toCompleteSince" TIMESTAMP(3);

ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_to_complete_kind"
  CHECK ("toCompleteSince" IS NULL OR "kind" = 'purchase');

CREATE INDEX "purchase_collectionId_toCompleteSince_idx" ON "purchase"("collectionId", "toCompleteSince");

-- Only the stamp, no condition or quantity (decided with the collector on 2026-10-17): a reminder of
-- what is in the parcel, which makes no copy and takes no part in the cost split.
CREATE TABLE "purchase_noted_stamp" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "purchase_noted_stamp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_noted_stamp_purchaseId_stampId_key" ON "purchase_noted_stamp"("purchaseId", "stampId");
CREATE INDEX "purchase_noted_stamp_stampId_idx" ON "purchase_noted_stamp"("stampId");

ALTER TABLE "purchase_noted_stamp" ADD CONSTRAINT "purchase_noted_stamp_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_noted_stamp" ADD CONSTRAINT "purchase_noted_stamp_stampId_fkey"
  FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
