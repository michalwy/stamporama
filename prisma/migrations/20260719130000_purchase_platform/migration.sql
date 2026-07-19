-- Purchase platform link (ADR-0009 §1, #120). A purchase can name the marketplace /
-- intermediary it went through (e.g. Allegro, eBay) separately from its supplier: both
-- are `contact` rows, the platform one carrying the `platform` role. Nullable FK with
-- the same `ON DELETE RESTRICT` guard as the supplier link.

ALTER TABLE "purchase" ADD COLUMN "platformId" TEXT;

CREATE INDEX "purchase_platformId_idx" ON "purchase"("platformId");

ALTER TABLE "purchase" ADD CONSTRAINT "purchase_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
