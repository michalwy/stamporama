-- A sale can be cancelled, not only deleted (#2500, ADR-0082). A cancelled sale keeps its row with
-- the status `cancelled` (a token of the existing `status` column, so no column change for it), when
-- and why it was cancelled, and what it had sold — its `sale_line` rows are deleted to free the
-- copies, sets and offers, so the lines are kept here as a record.

ALTER TABLE "sale" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "sale" ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE TABLE "sale_cancelled_line" (
  "id"           TEXT NOT NULL,
  "saleId"       TEXT NOT NULL,
  "offerId"      TEXT,
  "offerNo"      INTEGER,
  "title"        TEXT NOT NULL,
  "numbers"      TEXT,
  "price"        DECIMAL(10,2) NOT NULL,
  "freeExtra"    BOOLEAN NOT NULL DEFAULT false,
  "offerOutcome" TEXT,
  "position"     INTEGER NOT NULL,

  CONSTRAINT "sale_cancelled_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_cancelled_line_saleId_fkey" FOREIGN KEY ("saleId")
    REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sale_cancelled_line_offerId_fkey" FOREIGN KEY ("offerId")
    REFERENCES "offer"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "sale_cancelled_line_saleId_idx" ON "sale_cancelled_line"("saleId");
CREATE INDEX "sale_cancelled_line_offerId_idx" ON "sale_cancelled_line"("offerId");
