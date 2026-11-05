-- A stamp's issue format (#2439): the form the stamp was **issued** in — souvenir sheet, miniature
-- sheet, tête-bêche, booklet pane — as distinct from a copy's format, which is how the collector's
-- piece was cut or kept. Catalogue identity, the same for every copy of the stamp, so it lives on
-- `stamp`.
--
-- A per-collection dictionary shaped like `stamp_format` (name and abbreviation, both translatable)
-- with a condition's chip colour (#728). No issue format means an ordinary stamp: no "Stamp" row is
-- seeded, exactly as no "Single" format is, so every existing stamp keeps reading as an ordinary
-- stamp with no backfill on `stamp`.

CREATE TABLE "stamp_issue_format" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "abbreviation" TEXT NOT NULL,
  "sortOrder"    INTEGER NOT NULL,
  "color"        TEXT,

  CONSTRAINT "stamp_issue_format_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stamp_issue_format_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "stamp_issue_format_collectionId_idx" ON "stamp_issue_format"("collectionId");

CREATE TABLE "stamp_issue_format_translation" (
  "stampIssueFormatId" TEXT NOT NULL,
  "language"           TEXT NOT NULL,
  "name"               TEXT,
  "abbreviation"       TEXT,

  CONSTRAINT "stamp_issue_format_translation_pkey" PRIMARY KEY ("stampIssueFormatId", "language"),
  CONSTRAINT "stamp_issue_format_translation_stampIssueFormatId_fkey" FOREIGN KEY ("stampIssueFormatId")
    REFERENCES "stamp_issue_format"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- At most one per stamp. RESTRICT like every dictionary: a value in use is not deleted.
ALTER TABLE "stamp" ADD COLUMN "issueFormatId" TEXT;

ALTER TABLE "stamp" ADD CONSTRAINT "stamp_issueFormatId_fkey" FOREIGN KEY ("issueFormatId")
  REFERENCES "stamp_issue_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The in-use count on the settings row, and the filter #2440 puts on the lists.
CREATE INDEX "stamp_issueFormatId_idx" ON "stamp"("issueFormatId");

-- Existing collections get the starting values once, the same set and colours a new collection is
-- seeded with — kept in sync with `DEFAULT_ISSUE_FORMATS` (`src/lib/stamp-issue-format-defaults.ts`).
-- Ten values over the palette's ten hues, so each is distinct from the others; some share a hue with
-- a condition, as the collector chose.
INSERT INTO "stamp_issue_format" ("id", "collectionId", "name", "abbreviation", "sortOrder", "color")
SELECT
  'isf_' || c."id" || '_' || d."sortOrder",
  c."id",
  d."name",
  d."abbreviation",
  d."sortOrder",
  d."color"
FROM "collection" c
CROSS JOIN (VALUES
  ('Souvenir sheet',              'Bl',   0, 'indigo'),
  ('Stamp from a souvenir sheet', 'exBl', 1, 'violet'),
  ('Miniature sheet',             'MS',   2, 'blue'),
  ('Tête-bêche',                  'TB',   3, 'red'),
  ('Se-tenant',                   'ST',   4, 'orange'),
  ('Booklet',                     'MH',   5, 'pink'),
  ('Booklet pane',                'HBl',  6, 'amber'),
  ('Stamp from a booklet',        'exMH', 7, 'teal'),
  ('Coil stamp',                  'Coil', 8, 'green'),
  ('Postal stationery',           'PS',   9, 'slate')
) AS d("name", "abbreviation", "sortOrder", "color");
