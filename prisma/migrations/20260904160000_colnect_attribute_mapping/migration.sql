-- The Colnect side of a stamp-attribute dictionary (#739, part of #71).
--
-- Colnect prints its colour, watermark, paper and printing method as **text** while ours are
-- dictionary rows, so filling an attribute off a catalogue page needs a per-collection translation
-- between the two vocabularies — `ColnectConditionMapping` (#404) in a fourth form. It is a column
-- on the dictionary row rather than a table of its own because the mapping is strictly one-to-one
-- with that row (the condition mapping's own `@@unique` says the same thing), and four one-column
-- join tables over four parallel dictionaries would be four tables whose every row is a column.
--
-- Nullable and unmapped by default: nothing is seeded, and a Colnect value that maps to nothing is
-- **reported, never auto-created** — inventing dictionary rows off a scraped page is how a
-- vocabulary fills with near-duplicates.
--
-- Unique per collection so the lookup from Colnect's printed text is unambiguous: two colours
-- claiming "Carmine" would make the fill depend on which row the database handed back first.
-- NULLs are distinct in Postgres, so any number of rows may stay unmapped.

ALTER TABLE "stamp_color"    ADD COLUMN "colnectValue" TEXT;
ALTER TABLE "stamp_watermark" ADD COLUMN "colnectValue" TEXT;
ALTER TABLE "stamp_paper"    ADD COLUMN "colnectValue" TEXT;
ALTER TABLE "stamp_printing" ADD COLUMN "colnectValue" TEXT;

CREATE UNIQUE INDEX "stamp_color_collectionId_colnectValue_key"
  ON "stamp_color"("collectionId", "colnectValue");
CREATE UNIQUE INDEX "stamp_watermark_collectionId_colnectValue_key"
  ON "stamp_watermark"("collectionId", "colnectValue");
CREATE UNIQUE INDEX "stamp_paper_collectionId_colnectValue_key"
  ON "stamp_paper"("collectionId", "colnectValue");
CREATE UNIQUE INDEX "stamp_printing_collectionId_colnectValue_key"
  ON "stamp_printing"("collectionId", "colnectValue");
