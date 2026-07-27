-- Pre-downscale dimensions of an upload (#112 follow-up).
--
-- `width`/`height` are the *stored* `full` derivative's, clamped to FULL_MAX_EDGE. The collage
-- renderer composites tiles at their stored size on the assumption that a constant scanner DPI
-- makes those pixel sizes carry true relative sizes — which fails as soon as one scan is clamped
-- and another is not. These columns record what the upload measured before the downscale, so the
-- renderer can restore the true ratio.
--
-- Nullable, with no backfill possible: originals are never stored, so a pre-existing photo's
-- source dimensions are gone. Readers fall back to `width`/`height` (a scale factor of 1).
ALTER TABLE "photo" ADD COLUMN "original_width" INTEGER;
ALTER TABLE "photo" ADD COLUMN "original_height" INTEGER;

ALTER TABLE "photo_upload" ADD COLUMN "original_width" INTEGER;
ALTER TABLE "photo_upload" ADD COLUMN "original_height" INTEGER;
