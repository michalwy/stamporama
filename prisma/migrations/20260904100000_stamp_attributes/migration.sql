-- Stamp attributes (#71/#72): six typed columns on `stamp`, four of them references into new
-- per-collection dictionaries.
--
-- Denomination and perforation are facts about *one* stamp, printed rather than named and never
-- translated (`10 gr`, `1 zł`; `11½`, `11½:12`, `imperf`), so they are text as printed — a
-- dictionary of either would hold roughly a row per stamp. Colour, watermark, paper and printing
-- method are named sets a catalogue reuses and listing text a buyer reads in their own language,
-- which is the argument that produced `stamp_condition` and `stamp_subtype`; as free text they
-- would give `carmine` / `karminowy` / `Karmin` as three values of one thing.
--
-- The dictionaries are `stamp_subtype`'s shape with the behaviour stripped: no `actsAsVariant`
-- and no `isDefault`. There is no "usual colour" the way there is a usual condition — a stamp
-- that states none simply has none — so nothing is seeded into existing collections and nothing
-- is backfilled. Every reference is ON DELETE RESTRICT, as every other dictionary reference, so a
-- row in use cannot be deleted out from under a stamp.
--
-- Nothing is inherited down the variant tree: a variant is its own stamp with its own catalog
-- number (ADR-0010), so a child states its own value or states none. And the columns live on
-- `stamp`, never `item` — `stamp` is catalogue identity, `item` is condition, format and location.

CREATE TABLE "stamp_color" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "sortOrder"    INTEGER NOT NULL,

  CONSTRAINT "stamp_color_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stamp_color_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "stamp_color_collectionId_idx" ON "stamp_color"("collectionId");

CREATE TABLE "stamp_watermark" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "sortOrder"    INTEGER NOT NULL,

  CONSTRAINT "stamp_watermark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stamp_watermark_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "stamp_watermark_collectionId_idx" ON "stamp_watermark"("collectionId");

CREATE TABLE "stamp_paper" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "sortOrder"    INTEGER NOT NULL,

  CONSTRAINT "stamp_paper_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stamp_paper_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "stamp_paper_collectionId_idx" ON "stamp_paper"("collectionId");

CREATE TABLE "stamp_printing" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "sortOrder"    INTEGER NOT NULL,

  CONSTRAINT "stamp_printing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stamp_printing_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "stamp_printing_collectionId_idx" ON "stamp_printing"("collectionId");

-- Per-language `name` for each dictionary, following `stamp_subtype_translation` (#338): primary
-- key (parent, language), the parent's own `name` stays the default-language value, cascade-deleted
-- with the parent, and a missing row (or a NULL field) means "fall back to the default". One
-- translatable column — none of these has an abbreviation.

CREATE TABLE "stamp_color_translation" (
  "stampColorId" TEXT NOT NULL,
  "language"     TEXT NOT NULL,
  "name"         TEXT,

  CONSTRAINT "stamp_color_translation_pkey" PRIMARY KEY ("stampColorId", "language"),
  CONSTRAINT "stamp_color_translation_stampColorId_fkey" FOREIGN KEY ("stampColorId")
    REFERENCES "stamp_color"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "stamp_watermark_translation" (
  "stampWatermarkId" TEXT NOT NULL,
  "language"         TEXT NOT NULL,
  "name"             TEXT,

  CONSTRAINT "stamp_watermark_translation_pkey" PRIMARY KEY ("stampWatermarkId", "language"),
  CONSTRAINT "stamp_watermark_translation_stampWatermarkId_fkey" FOREIGN KEY ("stampWatermarkId")
    REFERENCES "stamp_watermark"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "stamp_paper_translation" (
  "stampPaperId" TEXT NOT NULL,
  "language"     TEXT NOT NULL,
  "name"         TEXT,

  CONSTRAINT "stamp_paper_translation_pkey" PRIMARY KEY ("stampPaperId", "language"),
  CONSTRAINT "stamp_paper_translation_stampPaperId_fkey" FOREIGN KEY ("stampPaperId")
    REFERENCES "stamp_paper"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "stamp_printing_translation" (
  "stampPrintingId" TEXT NOT NULL,
  "language"        TEXT NOT NULL,
  "name"            TEXT,

  CONSTRAINT "stamp_printing_translation_pkey" PRIMARY KEY ("stampPrintingId", "language"),
  CONSTRAINT "stamp_printing_translation_stampPrintingId_fkey" FOREIGN KEY ("stampPrintingId")
    REFERENCES "stamp_printing"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The six columns. All nullable; empty is the normal state, so no default and no backfill.
ALTER TABLE "stamp" ADD COLUMN "denomination" TEXT;
ALTER TABLE "stamp" ADD COLUMN "perforation"  TEXT;
ALTER TABLE "stamp" ADD COLUMN "colorId"      TEXT;
ALTER TABLE "stamp" ADD COLUMN "watermarkId"  TEXT;
ALTER TABLE "stamp" ADD COLUMN "paperId"      TEXT;
ALTER TABLE "stamp" ADD COLUMN "printingId"   TEXT;

ALTER TABLE "stamp" ADD CONSTRAINT "stamp_colorId_fkey" FOREIGN KEY ("colorId")
  REFERENCES "stamp_color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stamp" ADD CONSTRAINT "stamp_watermarkId_fkey" FOREIGN KEY ("watermarkId")
  REFERENCES "stamp_watermark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stamp" ADD CONSTRAINT "stamp_paperId_fkey" FOREIGN KEY ("paperId")
  REFERENCES "stamp_paper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stamp" ADD CONSTRAINT "stamp_printingId_fkey" FOREIGN KEY ("printingId")
  REFERENCES "stamp_printing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The in-use check behind a refused delete, and the filters #737 will put on the lists.
CREATE INDEX "stamp_colorId_idx"     ON "stamp"("colorId");
CREATE INDEX "stamp_watermarkId_idx" ON "stamp"("watermarkId");
CREATE INDEX "stamp_paperId_idx"     ON "stamp"("paperId");
CREATE INDEX "stamp_printingId_idx"  ON "stamp"("printingId");
