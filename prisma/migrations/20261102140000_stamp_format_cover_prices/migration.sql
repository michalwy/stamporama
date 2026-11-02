-- A stamp's prices on cover and on piece (#2356): EF, MeF and MiF — the stamp alone, several times,
-- or with other stamps on a genuinely posted cover — and on piece (Briefstück).
--
-- They are recorded on the price grid exactly as a format's prices are (ADR-0020): per edition,
-- condition and certificate, typed or derived by a multiplier from the single's price. So they are
-- stored as four **reserved rows of the format dictionary**, told apart by `coverKind`, and every
-- price path — the grid, the variant grid, the lists' switcher, the multipliers, the agent API —
-- carries them with no axis of its own.
--
-- They are prices only. A copy is never *in* one of them: a cover is a multi-stamp copy (ADR-0044),
-- and the copy, want, trade and auction pickers leave these rows out. Nor are they the collector's
-- to add, rename or delete — they are what the catalogues print, so every collection has the same
-- four, seeded here for the existing ones and on creation for the new.

ALTER TABLE "stamp_format" ADD COLUMN "coverKind" TEXT;

ALTER TABLE "stamp_format" ADD CONSTRAINT "stamp_format_coverKind_check"
  CHECK ("coverKind" IS NULL OR "coverKind" IN ('cover_ef', 'cover_mef', 'cover_mif', 'on_piece'));

-- One of each per collection.
CREATE UNIQUE INDEX "stamp_format_collectionId_coverKind_key"
  ON "stamp_format"("collectionId", "coverKind")
  WHERE "coverKind" IS NOT NULL;

INSERT INTO "stamp_format" ("id", "collectionId", "name", "abbreviation", "sortOrder", "coverKind")
SELECT
  gen_random_uuid()::text,
  c."id",
  d."name",
  d."abbreviation",
  d."sortOrder",
  d."coverKind"
FROM "collection" c
CROSS JOIN (VALUES
  ('Cover EF',  'EF',    0, 'cover_ef'),
  ('Cover MeF', 'MeF',   1, 'cover_mef'),
  ('Cover MiF', 'MiF',   2, 'cover_mif'),
  ('On piece',  'Piece', 3, 'on_piece')
) AS d("name", "abbreviation", "sortOrder", "coverKind");
