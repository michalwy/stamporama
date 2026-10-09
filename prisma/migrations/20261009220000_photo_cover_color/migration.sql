-- A solid cover has a colour of its own (#1702; ADR-0066, amended).
--
-- A bar was always black, which can clash with the stamp or the collage background. Each bar now
-- carries its colour as lowercase `#rrggbb`; pixelation and blur take theirs from the photo and
-- carry none. Every bar already drawn was black, so it is given black and its offer images stay
-- exactly as they were — the photo fingerprint names a bar's colour only when it is not black.
--
-- The platform gains the colour the first bar starts in, beside the style a new cover starts as.
-- Black, which is what every platform drew until now.

ALTER TABLE "photo_cover" ADD COLUMN "color" TEXT;

UPDATE "photo_cover" SET "color" = '#000000' WHERE "style" = 'bar';

ALTER TABLE "photo_cover" ADD CONSTRAINT "photo_cover_color_check"
    CHECK (("style" = 'bar') = ("color" IS NOT NULL) AND ("color" IS NULL OR "color" ~ '^#[0-9a-f]{6}$'));

ALTER TABLE "contact" ADD COLUMN "coverColor" TEXT NOT NULL DEFAULT '#000000';

ALTER TABLE "contact" ADD CONSTRAINT "contact_cover_color_check"
    CHECK ("coverColor" ~ '^#[0-9a-f]{6}$');
