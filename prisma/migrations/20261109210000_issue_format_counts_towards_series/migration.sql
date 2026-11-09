-- Each issue format says whether its entries count towards the series (#2470, ADR-0080). A piece a
-- catalogue prices as a whole — postal stationery, an FDC with a set — is an ordinary catalogue entry
-- in the issue beside the stamps; off, it no longer reads as one more member of the series. On for
-- every value by default, so nothing changes for souvenir sheets and the rest until the collector
-- says so. The switch is read, never written through to the checklists: membership is kept, so
-- turning it back on restores exactly what was there.
ALTER TABLE "stamp_issue_format" ADD COLUMN "countsTowardsSeries" BOOLEAN NOT NULL DEFAULT true;

-- Postal stationery is switched off once: by its seeded id (`20261105120000_stamp_issue_format`), so
-- a value the collector has since renamed is still found, or by its seeded name for a collection
-- created after that migration. Anything else is left for the collector to set.
UPDATE "stamp_issue_format"
SET "countsTowardsSeries" = false
WHERE "id" = 'isf_' || "collectionId" || '_9'
   OR "name" = 'Postal stationery';

-- FDC is added once to every existing collection, at the end of its order, unless the collector has
-- already made one — that value is theirs, and is switched off below instead of being doubled. No
-- colour: the palette's ten hues are taken by the ten starting values, and the neutral chip is
-- distinct from all of them.
INSERT INTO "stamp_issue_format" ("id", "collectionId", "name", "abbreviation", "sortOrder", "color", "countsTowardsSeries")
SELECT
  'isf_' || c."id" || '_fdc',
  c."id",
  'FDC',
  'FDC',
  COALESCE((SELECT MAX(f."sortOrder") + 1 FROM "stamp_issue_format" f WHERE f."collectionId" = c."id"), 0),
  NULL,
  false
FROM "collection" c
WHERE NOT EXISTS (
  SELECT 1 FROM "stamp_issue_format" f
  WHERE f."collectionId" = c."id"
    AND (lower(f."name") = 'fdc' OR lower(f."abbreviation") = 'fdc')
);

UPDATE "stamp_issue_format"
SET "countsTowardsSeries" = false
WHERE lower("name") = 'fdc' OR lower("abbreviation") = 'fdc';
