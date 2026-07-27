-- Per-language `name` / `abbreviation` for a stamp format (#344), following the
-- `stamp_condition_translation` shape (#294): primary key (parent, language), the parent's own
-- columns stay the default-language values, cascade-deleted with the parent, and a missing row
-- (or a NULL field) means "fall back to the default".
--
-- Two translatable columns, unlike the subtype's one: a format has an abbreviation, and the two
-- fall back independently — a Polish listing may translate "Block of 4" as "czwórka" while
-- keeping "Blk4" untouched.
CREATE TABLE "stamp_format_translation" (
    "stampFormatId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,
    "abbreviation" TEXT,

    CONSTRAINT "stamp_format_translation_pkey" PRIMARY KEY ("stampFormatId", "language")
);

ALTER TABLE "stamp_format_translation"
    ADD CONSTRAINT "stamp_format_translation_stampFormatId_fkey"
    FOREIGN KEY ("stampFormatId") REFERENCES "stamp_format"("id") ON DELETE CASCADE ON UPDATE CASCADE;
