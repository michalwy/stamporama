-- Preparing an uploaded card scan runs in the background (#1567).
--
-- The step after a scan's last chunk — assembling the parts, decoding a ~140 Mpx card and writing
-- the `view` — used to run inside the request that finalized the upload. A large card outlived the
-- proxy's patience (Cloudflare gives up at about 100 s, HTTP 524) and the collector was left with a
-- scan whose bytes had all arrived and no card to cut. So `scan_upload` becomes the queue as well as
-- the staging row: finalize marks it `queued` and answers at once, an in-process worker prepares one
-- scan at a time (ADR-0018), and the page reads the row's state rather than waiting on a request.
--
-- `status`: uploading → queued → preparing → done | failed. Every existing row is an upload still
-- arriving, which is exactly what the default says.
ALTER TABLE "scan_upload" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'uploading';
-- Why a preparation failed, in words for the card. Null unless `failed`.
ALTER TABLE "scan_upload" ADD COLUMN "error" TEXT;
-- When the last chunk was in and the scan joined the queue — the queue's order. A retry takes a new
-- place at the back.
ALTER TABLE "scan_upload" ADD COLUMN "queuedAt" TIMESTAMP(3);
-- The sheet a finished preparation made, which is how the page that is still open finds the card to
-- open the cut editor on. CASCADE: once the sheet is gone the row has nothing left to say.
ALTER TABLE "scan_upload" ADD COLUMN "sheetId" TEXT;

ALTER TABLE "scan_upload" ADD CONSTRAINT "scan_upload_sheetId_fkey"
    FOREIGN KEY ("sheetId") REFERENCES "scan_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "scan_upload_sheetId_key" ON "scan_upload"("sheetId");
CREATE INDEX "scan_upload_status_queuedAt_idx" ON "scan_upload"("status", "queuedAt");
