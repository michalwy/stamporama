-- A percentage of the plain price on each certificate status (#1242).
--
-- Catalogues often print one price per condition, which goes into the no-certificate column, and a
-- certified copy is worth that price times a fairly stable proportion per kind of certificate. The
-- collector sets that proportion once per status — signature 110, guarantee 120, photo attest 150 —
-- and the catalogue value grids use it to fill their certificate columns in one press.
--
-- Whole percent, as the collection's bid percentages are (`bidFloorPercent` and its siblings).
-- Nullable, and null is an answer of its own: a status with no percentage is left empty by the fill
-- rather than copied at 100%. No backfill — every existing status starts without one. The range is
-- enforced where the value is written (`src/lib/certificate-price-fill.ts`), not here.

ALTER TABLE "certificate_status" ADD COLUMN "pricePercent" INTEGER;
