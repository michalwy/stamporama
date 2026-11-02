-- The cover-price rows (#2356) are abbreviated by their full names. `EF` or `Piece` alone would read
-- poorly on a price tab beside `Blk4`, and worse, could equal the abbreviation of a format the
-- collector added for copies — the guide suggests a *Piece* format for fragments — making a name the
-- agent API resolves ambiguous. Corrects `20261102140000_stamp_format_cover_prices`, which seeded
-- the short forms.

UPDATE "stamp_format" SET "abbreviation" = "name" WHERE "coverKind" IS NOT NULL;
