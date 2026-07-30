-- Per-platform maximum lengths for the listing texts (#403, part of #155).
--
-- The same kind of fact as the photo limits already on this table: a hard technical limit on what
-- the platform's own form physically accepts. Colnect caps both its short description and its
-- private note at 100 characters (#402). Counted in UTF-16 code units, the unit an HTML `maxlength`
-- enforces, so the figure agrees with the field the text is pasted into.
--
-- Both nullable — no limit stated is the normal case — and, like the photo limits, never seeded onto
-- an offer: they describe the platform and are read live wherever the texts are written or copied.
-- Two columns because platforms cap the two texts independently.
ALTER TABLE "contact" ADD COLUMN "maxDescriptionLength" INTEGER;
ALTER TABLE "contact" ADD COLUMN "maxPrivateNoteLength" INTEGER;
