-- Collage templates (#307): named, reusable collage render presets scoped to a collection.
--
-- Rows × columns is **capacity, not a frame** — the renderer shrinks the canvas to actual contents
-- (#310). `gap` and `labelStripHeight` are output pixels: stamps are scanned at a constant DPI, so
-- the renderer already works in a pixel space carrying true relative sizes and needs no mm→px step.
--
-- A template is chosen on an offer and its values are copied onto that offer (#308), so nothing
-- references this table — editing a template never retroactively changes prepared offers.
--
-- No rows are seeded: sizing conventions depend on what the collector actually sells.

CREATE TABLE "collage_template" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "columns" INTEGER NOT NULL,
    "gap" INTEGER NOT NULL,
    "background" TEXT NOT NULL DEFAULT '#ffffff',
    "labelStripHeight" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "collage_template_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "collage_template_collectionId_idx" ON "collage_template"("collectionId");

ALTER TABLE "collage_template"
    ADD CONSTRAINT "collage_template_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
