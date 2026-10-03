-- A tile's condition and certificate, marked before it is identified (#1550).
--
-- The collector marks them straight after scanning, with the card still in hand, because the scan
-- alone often cannot tell MNH from MNG and identification comes later, when the card may be put
-- away. A mark only seeds the identification dialogs; the copy takes what the dialog confirms.
--
-- Each half is optional: a tile can be marked with a condition, a certificate, both or neither.
-- `markedAt` is when the mark last changed, which is what decides between a front's and a back's
-- different marks when the two are paired: the mark given last wins.
ALTER TABLE "scan_tile" ADD COLUMN "markConditionId" TEXT;
ALTER TABLE "scan_tile" ADD COLUMN "markCertificateStatusId" TEXT;
ALTER TABLE "scan_tile" ADD COLUMN "markedAt" TIMESTAMP(3);

CREATE INDEX "scan_tile_markConditionId_idx" ON "scan_tile"("markConditionId");
CREATE INDEX "scan_tile_markCertificateStatusId_idx" ON "scan_tile"("markCertificateStatusId");

-- SET NULL: a condition or certificate status deleted from the dictionary takes the mark with it,
-- and nothing else — the tile is still to be identified.
ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_markConditionId_fkey"
    FOREIGN KEY ("markConditionId") REFERENCES "stamp_condition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_markCertificateStatusId_fkey"
    FOREIGN KEY ("markCertificateStatusId") REFERENCES "certificate_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;
