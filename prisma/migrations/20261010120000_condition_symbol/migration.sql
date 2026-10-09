-- A condition has a symbol beside its name and abbreviation (#1739): `**` for MNH, `*` for MH,
-- `(*)` for no gum — what catalogues and many listings print instead of either.
--
-- Optional and empty until the collector sets it: nothing is filled in for existing conditions or
-- for the ones a new collection is seeded with (#1692). It is the same in every language, so it
-- gets no column on `stamp_condition_translation`.

ALTER TABLE "stamp_condition" ADD COLUMN "symbol" TEXT;
