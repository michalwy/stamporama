-- The Colnect side of the issue-format dictionary (#2443, on #2439): what Colnect prints in a
-- stamp's "Format" for the value this row stands for — "Souvenir Sheet", "Miniature Sheet" — so a
-- catalogue page can fill a stamp's issue format the way it fills its colour or paper (#739).
--
-- The four attribute dictionaries' own column, on the same terms (20260904160000): nullable and
-- unmapped by default, nothing seeded, a Colnect word that maps to nothing reported and never
-- auto-created. Colnect's "Stamp" is an ordinary stamp, which is no issue format at all, so no row
-- ever stands for it.
--
-- Unique per collection so the lookup from Colnect's printed word is unambiguous. NULLs are distinct
-- in Postgres, so any number of rows may stay unmapped.

ALTER TABLE "stamp_issue_format" ADD COLUMN "colnectValue" TEXT;

CREATE UNIQUE INDEX "stamp_issue_format_collectionId_colnectValue_key"
  ON "stamp_issue_format"("collectionId", "colnectValue");
