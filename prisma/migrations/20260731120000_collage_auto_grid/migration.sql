-- Auto grid mode for collage templates (#413).
--
-- `rows` × `columns` has always been capacity rather than a frame (#307/#310) — the canvas shrinks
-- to its contents. What it did *not* say is how wide a row should be when the tile count changes:
-- `columns` was both the bound and the shape, so a template suited to a set of nine produced a
-- lopsided image for a set of four. `gridMode = 'auto'` reads the two numbers as bounds only and
-- lets the renderer pick the width per image; `'fixed'` is the behaviour every existing template
-- has, which is why it is the default here and on the offer.
--
-- On the offer the column is nullable and deliberately *outside* the all-or-nothing collage group:
-- an offer prepared before this migration carries collage numbers and no mode, and null there has to
-- keep meaning `fixed` rather than "no collage".

ALTER TABLE "collage_template"
    ADD COLUMN "gridMode" TEXT NOT NULL DEFAULT 'fixed';

ALTER TABLE "offer"
    ADD COLUMN "collageGridMode" TEXT;
