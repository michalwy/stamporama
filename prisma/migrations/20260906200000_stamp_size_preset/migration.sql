-- The stamp size presets a collection has saved (#803; ADR-0048).
--
-- A pair of millimetres the collector already knows, kept so it can be written onto a stamp — or
-- onto forty — without the stamp being in hand. #763 gave a stamp a size and two ways to obtain
-- one, and both need a scan; a stamp with none borrows the nearest neighbour of the same checklist,
-- which is exactly what a new overprint run has none of. The figure is not missing, only the way to
-- state it.
--
-- **Copied, never referenced.** Applying a preset writes `stamp."widthMm"` / `stamp."heightMm"` and
-- nothing else: there is deliberately no `stampSizePresetId` on `stamp`, so nothing here reaches
-- back into a stamp already sized, and correcting a preset does not correct them. `album_template`
-- is the same bargain for the same reason.
--
-- `numeric(5,1)`, matching `stamp."widthMm"` / `stamp."heightMm"` byte for byte, because the pair is
-- copied onto those columns and is also the row's own identity: the unique index below is an exact
-- match, and `double precision` would make two presets out of one typed figure.
--
-- Nothing is backfilled and nothing is seeded — in a real collection or in the demo dataset. There
-- is nothing to backfill from (no earlier column held a size the collector *knew* rather than
-- measured), and a seeded preset is the app asserting a millimetre nobody measured, which the
-- collector then cuts hawid to. An empty list should look unfilled.

CREATE TABLE "stamp_size_preset" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "widthMm" DECIMAL(5,1) NOT NULL,
    "heightMm" DECIMAL(5,1) NOT NULL,
    "name" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stamp_size_preset_pkey" PRIMARY KEY ("id")
);

-- The numbers are the identity and the name is a label (ADR-0048 §3), `hawid_strip`'s shape: two
-- presets stating the same pair are one preset, and the clash is reported as its own error rather
-- than as a failed save.
CREATE UNIQUE INDEX "stamp_size_preset_collectionId_widthMm_heightMm_key" ON "stamp_size_preset"("collectionId", "widthMm", "heightMm");

CREATE INDEX "stamp_size_preset_collectionId_idx" ON "stamp_size_preset"("collectionId");

ALTER TABLE "stamp_size_preset" ADD CONSTRAINT "stamp_size_preset_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
