-- Back the inventory item acquisition source with the `Contact` entity (#108,
-- ADR-0007 §5, ADR-0008) instead of a free-form string. Drop `acquisitionSource`
-- and add a nullable `contactId` FK -> contact. No data backfill: there is no
-- production data yet, so no best-effort contact creation from existing strings.
--
-- The FK uses ON DELETE RESTRICT: a contact referenced by an item cannot be
-- deleted without first detaching it, protecting acquisition history (ADR-0008 §4).

ALTER TABLE "item" DROP COLUMN "acquisitionSource";

ALTER TABLE "item" ADD COLUMN "contactId" TEXT;

CREATE INDEX "item_contactId_idx" ON "item"("contactId");

ALTER TABLE "item" ADD CONSTRAINT "item_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
