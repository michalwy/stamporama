-- Cover symbols on offer photos (#1665; ADR-0066).
--
-- Covers are kept with the copy's photo as a layer applied only to offer images: the photo's own
-- bytes, and every screen showing it as the copy's or the stamp's photo, are untouched. A photo is
-- *checked* once the collector has gone over it, with covers drawn or marked nothing to cover.
-- Every photo already in the collection starts unchecked and with no covers, so no offer image
-- already generated changes or goes out of date here.

CREATE TABLE "photo_cover" (
    "id" TEXT NOT NULL,
    "photo_id" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_cover_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "photo_cover_shape_check" CHECK ("shape" IN ('rect', 'ellipse')),
    CONSTRAINT "photo_cover_style_check" CHECK ("style" IN ('pixelate', 'blur', 'bar'))
);

CREATE INDEX "photo_cover_photo_id_idx" ON "photo_cover"("photo_id");

ALTER TABLE "photo_cover" ADD CONSTRAINT "photo_cover_photo_id_fkey"
    FOREIGN KEY ("photo_id") REFERENCES "photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "photo" ADD COLUMN "covers_checked_at" TIMESTAMP(3);

-- The platform says whether its offers need covers, read live; an offer may override it either way
-- (null follows the platform).
ALTER TABLE "contact" ADD COLUMN "coverSymbols" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contact" ADD COLUMN "coverStyle" TEXT NOT NULL DEFAULT 'pixelate';
ALTER TABLE "offer" ADD COLUMN "coverSymbols" BOOLEAN;

-- Facebook is the platform that asked for it.
UPDATE "contact" SET "coverSymbols" = true WHERE "platformModule" = 'facebook';
