-- Sale fulfillment status (#191): ordered → paid → packed → sent → received. Existing sales
-- default to `ordered` (they predate the status axis; the collector can advance them manually).
ALTER TABLE "sale" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ordered';

-- Append-only transition log (#191): one row per status change, stamped at the moment of transition,
-- so the sale's progression is preserved for future reporting/audit. Cascades with its sale.
CREATE TABLE "sale_status_event" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_status_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sale_status_event_saleId_idx" ON "sale_status_event"("saleId");

ALTER TABLE "sale_status_event"
    ADD CONSTRAINT "sale_status_event_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the initial `ordered` event for every existing sale, backdated to when the sale was created,
-- so pre-existing sales have a non-empty transition timeline.
INSERT INTO "sale_status_event" ("id", "saleId", "status", "changedAt")
SELECT 'sse_' || "id", "id", 'ordered', "createdAt" FROM "sale";

-- Per-copy packed flag (#192), independent of the sale's overall status. Existing copies default
-- unpacked.
ALTER TABLE "sale_line_item" ADD COLUMN "packed" BOOLEAN NOT NULL DEFAULT false;
