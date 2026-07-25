-- Per-language entity text foundation (#265, #293).

-- The language a platform's generated listing text is written in (free ISO 639-1 code). Only
-- platform contacts use it; the collection's language set is derived as the distinct set of values.
ALTER TABLE "contact" ADD COLUMN "titleLanguage" TEXT;

-- Per-language override of `collection_area.titleName`, which stays the default-language value.
-- One row per (area, language); a missing row means "fall back to the default".
CREATE TABLE "collection_area_translation" (
    "collectionAreaId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "titleName" TEXT,

    CONSTRAINT "collection_area_translation_pkey" PRIMARY KEY ("collectionAreaId", "language")
);

ALTER TABLE "collection_area_translation"
    ADD CONSTRAINT "collection_area_translation_collectionAreaId_fkey"
    FOREIGN KEY ("collectionAreaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
