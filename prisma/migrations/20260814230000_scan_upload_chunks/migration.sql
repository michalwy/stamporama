-- A card scan uploaded in **chunks** (#590).
--
-- A 1200 dpi stockbook card is 100–200 MB, and the upload failed with 413 before it reached the
-- app: nginx defaults `client_max_body_size` to 1 MB and Cloudflare caps a body at 100 MB, so the
-- app's own 200 MB `MAX_UPLOAD_BYTES` was asking the operator's proxy for something most of them
-- refuse. Chunking removes the requirement rather than restating it at a higher number, and it sits
-- in the HTTP layer so both storage backends behave identically.
--
-- This table is what holds an upload together between the request that opens it and the one that
-- finalizes it. Its parts are ordinary storage objects under `staging/scan-uploads/<id>/`, so the
-- storage interface grows no append and no compose; the row exists because storage has no `list`
-- and an abandoned upload has to be *findable* — the sweep reads it and deletes the parts by index.
--
-- It is staging in the same sense `photo_upload` is, and is swept on the same TTL by the same pass.
CREATE TABLE "scan_upload" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "batchNo" INTEGER,
    "label" TEXT,
    "mime" TEXT NOT NULL,
    "totalBytes" INTEGER NOT NULL,
    "chunkBytes" INTEGER NOT NULL,
    "receivedChunks" INTEGER NOT NULL DEFAULT 0,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "storageBackend" TEXT NOT NULL DEFAULT 'filesystem',
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_upload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scan_upload_purchaseId_idx" ON "scan_upload"("purchaseId");

-- The sweep measures an upload's age from its **last accepted chunk**, not from when it was opened:
-- a 200 MB card over a home connection can legitimately take longer to send than the TTL.
CREATE INDEX "scan_upload_updatedAt_idx" ON "scan_upload"("updatedAt");

ALTER TABLE "scan_upload" ADD CONSTRAINT "scan_upload_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
