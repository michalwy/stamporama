-- A piece has no condition (#2383, ADR-0079). A piece is a copy carrying several stamps, or one stamp
-- on a format whose kind is on cover or on piece (ADR-0076). Its condition meant nothing — "MNH" on a
-- posted cover — and since #2375 no price is read from it; what it still did was count a one-stamp
-- cover as a copy of its stamp in that condition. The column becomes nullable, and null exactly when
-- the copy is a piece: the held-copy predicates read it as the flat flag `stampCount` once was.
ALTER TABLE "item" ALTER COLUMN "conditionId" DROP NOT NULL;

-- Existing pieces lose theirs. Nothing is kept elsewhere: the value never read it.
UPDATE "item"
SET "conditionId" = NULL
WHERE "stampCount" > 1
   OR "formatId" IN (SELECT "id" FROM "stamp_format" WHERE "pieceKind" IS NOT NULL);
