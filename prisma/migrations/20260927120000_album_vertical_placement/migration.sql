-- Where an album page's content sits vertically (#1419).
--
-- A template value, copied onto the album like every other (#308's rule), and an override for a
-- single page. `top` is the default on both columns because it is what every page printed before
-- this reads as: an existing album and an existing template keep their pages exactly.
ALTER TABLE "album_template" ADD COLUMN "verticalPlacement" TEXT NOT NULL DEFAULT 'top';
ALTER TABLE "album" ADD COLUMN "verticalPlacement" TEXT NOT NULL DEFAULT 'top';

-- The per-page override hangs on the block that **opens** the page — an entry or a note — and never
-- on the page, for ADR-0045 §3's reason: a live page has no row and its identity moves with its
-- contents. Null follows the album.
ALTER TABLE "album_entry" ADD COLUMN "pagePlacement" TEXT;
ALTER TABLE "album_text_block" ADD COLUMN "pagePlacement" TEXT;
