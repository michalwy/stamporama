-- Replace the partial acquisition date (acquiredDay/Month/Year) on `item` with a
-- single full DATE column `acquiredDate` (ADR-0007 §5, revised: acquisition date is
-- a complete date, entered via a date control). Existing rows are backfilled only
-- where all three parts are present; partial dates (e.g. year only) cannot map to a
-- full date and are dropped.

ALTER TABLE "item" ADD COLUMN "acquiredDate" DATE;

UPDATE "item"
SET "acquiredDate" = make_date("acquiredYear", "acquiredMonth", "acquiredDay")
WHERE "acquiredYear" IS NOT NULL
  AND "acquiredMonth" IS NOT NULL
  AND "acquiredDay" IS NOT NULL;

ALTER TABLE "item" DROP COLUMN "acquiredDay";
ALTER TABLE "item" DROP COLUMN "acquiredMonth";
ALTER TABLE "item" DROP COLUMN "acquiredYear";
