-- Per-language `name` for a stamp subtype (#338), following the `issue_translation` /
-- `stamp_translation` shape (#295, #296): primary key (parent, language), the parent's own
-- `name` column stays the default-language value, cascade-deleted with the parent, and a missing
-- row (or a NULL field) means "fall back to the default".
--
-- One translatable column, not two: a subtype has no abbreviation. It is behind the `{subtype}`
-- token (#339), which is why it needs translating at all — a Polish listing should read
-- "Nadruk", not "Overprint".
CREATE TABLE "stamp_subtype_translation" (
    "stampSubtypeId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "stamp_subtype_translation_pkey" PRIMARY KEY ("stampSubtypeId", "language")
);

ALTER TABLE "stamp_subtype_translation"
    ADD CONSTRAINT "stamp_subtype_translation_stampSubtypeId_fkey"
    FOREIGN KEY ("stampSubtypeId") REFERENCES "stamp_subtype"("id") ON DELETE CASCADE ON UPDATE CASCADE;
