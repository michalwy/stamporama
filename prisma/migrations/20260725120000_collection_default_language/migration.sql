-- The language a collection's default-language entity text is written in (#293). Existing
-- collections predate the setting and their text is assumed English, which the column default
-- backfills for every current row.
ALTER TABLE "collection" ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'en';
