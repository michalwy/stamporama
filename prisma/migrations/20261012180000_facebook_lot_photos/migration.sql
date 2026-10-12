-- A captioned Facebook post's lot photos are drawn once in the background and stored (#1861), no
-- longer on every view and every download. One row per offer: the queue row the worker claims, and the
-- record of the stored image and what it was drawn from. The image itself is an ordinary generated
-- `photo` row owned by the offer, so it counts in the collection's storage and goes with the
-- closed-offer sweep (#512); the sweep deleting it leaves the row with no photo.
--
-- Nothing is backfilled: a captioned post's lots are queued the first time the post is read.

CREATE TABLE "facebook_lot_photo" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    -- queued | running | ready | failed
    "status" TEXT NOT NULL DEFAULT 'queued',
    -- What the stored image was drawn from, or what a failed run tried to draw.
    "fingerprint" TEXT,
    "photoId" TEXT,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "facebook_lot_photo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "facebook_lot_photo_offerId_key" ON "facebook_lot_photo"("offerId");
CREATE UNIQUE INDEX "facebook_lot_photo_photoId_key" ON "facebook_lot_photo"("photoId");

-- The worker claims the oldest queued row; the index serves exactly that query.
CREATE INDEX "facebook_lot_photo_status_queuedAt_idx" ON "facebook_lot_photo"("status", "queuedAt");

ALTER TABLE "facebook_lot_photo" ADD CONSTRAINT "facebook_lot_photo_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "facebook_lot_photo" ADD CONSTRAINT "facebook_lot_photo_photoId_fkey"
    FOREIGN KEY ("photoId") REFERENCES "photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
