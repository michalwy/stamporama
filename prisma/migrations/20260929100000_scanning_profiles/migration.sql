-- Scanning profiles (#1443): a named scanner at a resolution, with an optional per-axis calibration,
-- chosen wherever a scan is measured instead of the bare `collection.scanDpi` #598 introduced.
--
-- ## Why a profile rather than a better dpi
--
-- A scanner rarely delivers exactly its nominal resolution: a nominal 1200 dpi may really be 1195
-- across the glass and 1198 along it, and on a 25 mm stamp that is the few tenths of a millimetre the
-- collector saw measurements come out large by. The two axes are set by different parts — the sensor
-- across the scan, the carriage motor along it — so they are calibrated separately, and a collector
-- can own more than one scanner, so the calibration belongs to a named profile rather than to the
-- collection.
--
-- ## Calibration is optional and both-or-neither
--
-- An uncalibrated profile measures at its nominal dpi and says so. A calibrated one holds the
-- effective resolution of each axis, derived from a scan of an object of known length (a ruler).
-- Half a calibration is not one — a reading taken along the uncalibrated axis would quietly be the
-- nominal figure beside a label saying *calibrated* — so the check refuses one column without the
-- other. Two decimals: an effective resolution is a quotient, and 1195.37 is what the ruler said.
--
-- ## One default per collection, carried from the old setting
--
-- Every collection gets a first profile at its current `scanDpi`, uncalibrated, and it becomes the
-- default — so nothing measures differently until the collector calibrates. `scanDpi` then goes: a
-- second place the collection's scale could be read from is the thing #598 said must never exist.
--
-- `defaultScanningProfileId` is nullable only because the two rows refer to each other and one has to
-- be written first; the app writes the default in the same transaction that creates the collection.
--
-- ## A profile in use cannot be deleted
--
-- Collector's call on 2026-09-28: a profile that is the default, that a scan was taken with, or that a
-- stamp's size was measured with is refused deletion. The references are `NO ACTION` rather than
-- `RESTRICT` so that deleting a whole collection — which cascades to its profiles, its scans and its
-- stamps in one statement — is checked at the end of that statement, when nothing is left to point
-- anywhere. The app checks first and says why; the constraint is the backstop.
--
-- ## What records a profile
--
-- `scan_sheet.scanningProfileId` — what the card was scanned with, chosen at upload, prefilled with the
-- default. Null on every sheet that existed before this migration: those were scanned at "the
-- collection's dpi", which is the default profile, and the viewer opens a sheet with no profile on the
-- default, exactly as it opened one on `scanDpi` before.
--
-- `scan_upload.scanningProfileId` — the choice carried from the open of a chunked upload to its
-- finalize. `SET NULL`: an upload is staging, and an abandoned one must not pin a profile.
--
-- `stamp.sizeScanningProfileId` — the profile a stamp's size was measured with, from now on. Sizes
-- already saved are not touched: they keep what they were, a size with no profile recorded. A size
-- typed, applied from a preset or written by the assistant carries none.

CREATE TABLE "scanning_profile" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nominalDpi" INTEGER NOT NULL,
    "calibratedDpiX" DECIMAL(6, 2),
    "calibratedDpiY" DECIMAL(6, 2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scanning_profile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scanning_profile_calibration_both_or_neither"
        CHECK (("calibratedDpiX" IS NULL) = ("calibratedDpiY" IS NULL))
);

CREATE UNIQUE INDEX "scanning_profile_collectionId_name_key" ON "scanning_profile"("collectionId", "name");
CREATE INDEX "scanning_profile_collectionId_idx" ON "scanning_profile"("collectionId");

ALTER TABLE "scanning_profile" ADD CONSTRAINT "scanning_profile_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The first profile of every collection, at the resolution it measured at until now.
INSERT INTO "scanning_profile" ("id", "collectionId", "name", "nominalDpi")
SELECT gen_random_uuid()::text, c."id", 'Scanner', c."scanDpi"
FROM "collection" c;

ALTER TABLE "collection" ADD COLUMN "defaultScanningProfileId" TEXT;

UPDATE "collection" c
SET "defaultScanningProfileId" = p."id"
FROM "scanning_profile" p
WHERE p."collectionId" = c."id";

CREATE UNIQUE INDEX "collection_defaultScanningProfileId_key" ON "collection"("defaultScanningProfileId");

ALTER TABLE "collection" ADD CONSTRAINT "collection_defaultScanningProfileId_fkey"
    FOREIGN KEY ("defaultScanningProfileId") REFERENCES "scanning_profile"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "collection" DROP COLUMN "scanDpi";

ALTER TABLE "scan_sheet" ADD COLUMN "scanningProfileId" TEXT;
CREATE INDEX "scan_sheet_scanningProfileId_idx" ON "scan_sheet"("scanningProfileId");
ALTER TABLE "scan_sheet" ADD CONSTRAINT "scan_sheet_scanningProfileId_fkey"
    FOREIGN KEY ("scanningProfileId") REFERENCES "scanning_profile"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "scan_upload" ADD COLUMN "scanningProfileId" TEXT;
ALTER TABLE "scan_upload" ADD CONSTRAINT "scan_upload_scanningProfileId_fkey"
    FOREIGN KEY ("scanningProfileId") REFERENCES "scanning_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stamp" ADD COLUMN "sizeScanningProfileId" TEXT;
CREATE INDEX "stamp_sizeScanningProfileId_idx" ON "stamp"("sizeScanningProfileId");
ALTER TABLE "stamp" ADD CONSTRAINT "stamp_sizeScanningProfileId_fkey"
    FOREIGN KEY ("sizeScanningProfileId") REFERENCES "scanning_profile"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
