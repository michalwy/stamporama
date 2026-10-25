-- Fronts and backs uploaded together (#2163): the collector scans a stack alternately — front,
-- back, front, back — and adds the whole sitting in one go, each back joining its own front's card.
--
-- A back names the batch it joins, and a front's batch number is only allocated when the front is
-- prepared into a sheet, in the background (#1567) — long after both files were opened. So a back
-- sent with its front names the front's **upload** instead, and is given the batch number in the
-- transaction that turns the front into a card. The worker leaves such a back in the queue while its
-- front is still arriving or waiting, so a front sent again after a failure is still prepared first.
--
-- SET NULL: a front discarded before it became a card leaves its back with no card to join, which
-- the preparation then says in words rather than the row disappearing under the panel.
ALTER TABLE "scan_upload" ADD COLUMN "frontUploadId" TEXT;

ALTER TABLE "scan_upload" ADD CONSTRAINT "scan_upload_frontUploadId_fkey"
    FOREIGN KEY ("frontUploadId") REFERENCES "scan_upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "scan_upload_frontUploadId_idx" ON "scan_upload"("frontUploadId");
