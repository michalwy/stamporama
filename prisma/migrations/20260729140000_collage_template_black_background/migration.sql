-- A new collage template starts on a **black** canvas (#381). A stamp scan carries its own pale
-- margins, so on white the tile's edge dissolves into the background and a collage reads as stamps
-- floating in nothing; the label ink follows the background's luminance either way, so a caption
-- stays readable. Only the default moves — templates already written keep their colour, which is
-- the colour their listings' images were produced with.
ALTER TABLE "collage_template" ALTER COLUMN "background" SET DEFAULT '#000000';
