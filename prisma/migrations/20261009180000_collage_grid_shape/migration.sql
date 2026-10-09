-- The shape the automatic collage grid aims at (#1699), as a setting of a collage template and of an
-- offer's collage numbers.
--
-- The automatic grid (#413/#514) has always aimed at a landscape canvas (#526): anything from 4:3 to
-- 16:9 counts as equally good. That suits most platforms, but a Facebook feed shows upright images
-- larger, so the shape becomes a choice — `landscape` (4:3–16:9), `portrait` (3:4–9:16) or `square`
-- (5:4–4:5). A fixed grid has no target shape, so the value is only read under `auto`.
--
-- `landscape` everywhere: every existing template keeps the rule it renders by today. On the offer
-- the columns are nullable and outside the all-or-nothing collage group, as `collageGridMode` is —
-- an offer prepared before this migration carries no shape, and null there reads as `landscape`, so
-- no offer's photos change until a shape is chosen.

ALTER TABLE "collage_template"
    ADD COLUMN "gridShape" TEXT NOT NULL DEFAULT 'landscape';

ALTER TABLE "offer"
    ADD COLUMN "collageGridShape" TEXT,
    ADD COLUMN "groupCollageGridShape" TEXT;
