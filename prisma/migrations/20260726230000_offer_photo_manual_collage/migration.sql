-- A manual collage attachment on an offer (#331).
--
-- #313 gave the plan two manual modes, each showing exactly one image: a specific photo of a copy,
-- or an image uploaded straight to the offer. Neither covers a grouping the automatic rules do not
-- produce — a handful of chosen photos combined into one image because *that* is what the listing
-- wants to show. This is the third mode: `source = 'manual_collage'`, a set of chosen tiles laid
-- out at a column count the collector picks.
--
-- Every attachment now reads as "N tiles in C columns": a copy photo or an upload is that with one
-- tile in one column, which is the one-tile-collage the renderer already produces (#310/#312). So
-- the tiles get their own table and `photoId` becomes the single-tile shorthand it always was —
-- NULL for a collage, whose tiles are the child rows.
--
-- Rows, deliberately, are not stored. A collage template's rows × columns is a *capacity* the plan
-- fills (#308); here the contents are the explicit thing the collector picked, so the only open
-- question is how wide to lay them out. The row count follows from the two.
--
-- A tile carries its own `source`, for the same lifecycle reason the attachment does: an `upload`
-- tile's photo is offer-owned (`kind = 'original'`) and exists for this collage alone, so removing
-- the attachment deletes that row and its bytes, while a `copy_photo` tile only ever pointed at the
-- copy's own scan and leaves it be.

ALTER TABLE "offer_photo_attachment" ALTER COLUMN "photoId" DROP NOT NULL;

-- How many tiles per row a manual collage is laid out at; NULL for the single-image modes.
ALTER TABLE "offer_photo_attachment" ADD COLUMN "collageColumns" INTEGER;

-- The old constraint knew two modes and would refuse the third outright.
ALTER TABLE "offer_photo_attachment" DROP CONSTRAINT "offer_photo_attachment_source_item";

-- Each mode's shape, in one place: a copy photo names its copy and its photo, an upload names only
-- its photo, and a collage names neither — its tiles do — but does name a column count.
ALTER TABLE "offer_photo_attachment" ADD CONSTRAINT "offer_photo_attachment_source_shape"
    CHECK (
        ("source" = 'copy_photo' AND "itemId" IS NOT NULL AND "photoId" IS NOT NULL
            AND "collageColumns" IS NULL)
        OR ("source" = 'upload' AND "itemId" IS NULL AND "photoId" IS NOT NULL
            AND "collageColumns" IS NULL)
        OR ("source" = 'manual_collage' AND "itemId" IS NULL AND "photoId" IS NULL
            AND "collageColumns" IS NOT NULL AND "collageColumns" >= 1)
    );

-- One tile of a manual collage (#331), in the order the collector arranged them.
CREATE TABLE "offer_photo_attachment_tile" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    -- 0-based, dense. Tiles fill the collage left to right, row by row, in this order.
    "sortOrder" INTEGER NOT NULL,
    -- copy_photo | upload — the same distinction the parent draws, and for the same reason: it says
    -- who owns the bytes.
    "source" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    -- The copy whose data annotates this tile (#312); NULL for an uploaded image, whose inventory
    -- tokens resolve empty while the label template's literal text still renders.
    "itemId" TEXT,

    CONSTRAINT "offer_photo_attachment_tile_pkey" PRIMARY KEY ("id")
);

-- Tiles are always read in order, per attachment.
CREATE INDEX "offer_photo_attachment_tile_attachmentId_sortOrder_idx"
    ON "offer_photo_attachment_tile"("attachmentId", "sortOrder");
CREATE INDEX "offer_photo_attachment_tile_photoId_idx"
    ON "offer_photo_attachment_tile"("photoId");
CREATE INDEX "offer_photo_attachment_tile_itemId_idx"
    ON "offer_photo_attachment_tile"("itemId");

ALTER TABLE "offer_photo_attachment_tile"
    ADD CONSTRAINT "offer_photo_attachment_tile_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "offer_photo_attachment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a source scan drops the tile from *future* plans, exactly as it drops a single-photo
-- attachment; the image already generated from it is a separate `photo` row and survives, which is
-- the staleness the fingerprint reports.
ALTER TABLE "offer_photo_attachment_tile"
    ADD CONSTRAINT "offer_photo_attachment_tile_photoId_fkey"
    FOREIGN KEY ("photoId") REFERENCES "photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offer_photo_attachment_tile"
    ADD CONSTRAINT "offer_photo_attachment_tile_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offer_photo_attachment_tile" ADD CONSTRAINT "offer_photo_attachment_tile_source_item"
    CHECK (
        ("source" = 'copy_photo' AND "itemId" IS NOT NULL)
        OR ("source" = 'upload' AND "itemId" IS NULL)
    );
