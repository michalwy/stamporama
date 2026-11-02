-- Stamps still valid for postage get their on-cover prices from Michel's rule (#2358).
--
-- Michel prints no ⊠ price for a stamp still valid for postage and states a rule instead: at least
-- 0.40, or about 20 % above the used price, but no more than the never-hinged price when that is
-- above 0.40. The rule fills a still-valid stamp's EF, MeF and MiF prices (#2356) where none is typed.
--
-- 1. Which stamps are still valid is marked on an issue or an area, three states as the forbidden-
--    symbols flag has (#1891): NULL follows the parent (an issue follows its area), TRUE and FALSE
--    are set here and pass down. A tree that says nothing is not still valid.

ALTER TABLE "collection_area" ADD COLUMN "stillValidForPostage" BOOLEAN;
ALTER TABLE "issue" ADD COLUMN "stillValidForPostage" BOOLEAN;

-- 2. Which condition the rule reads as *used* and which as *never hinged* is chosen once for the
--    collection, as a role on the condition — at most one of each per collection. Deleting the
--    condition takes its role with it, and the rule then gives nothing until another is chosen.

ALTER TABLE "stamp_condition" ADD COLUMN "priceRole" TEXT;

ALTER TABLE "stamp_condition" ADD CONSTRAINT "stamp_condition_priceRole_check"
  CHECK ("priceRole" IS NULL OR "priceRole" IN ('used', 'never_hinged'));

CREATE UNIQUE INDEX "stamp_condition_collectionId_priceRole_key"
  ON "stamp_condition"("collectionId", "priceRole")
  WHERE "priceRole" IS NOT NULL;

-- Preselected where the seeded conditions still exist: U is used, MNH is never hinged. A collection
-- holding two conditions with one abbreviation takes the first in its order.

UPDATE "stamp_condition" SET "priceRole" = 'used'
WHERE "id" IN (
  SELECT DISTINCT ON ("collectionId") "id" FROM "stamp_condition"
  WHERE "abbreviation" = 'U'
  ORDER BY "collectionId", "sortOrder", "id"
);

UPDATE "stamp_condition" SET "priceRole" = 'never_hinged'
WHERE "id" IN (
  SELECT DISTINCT ON ("collectionId") "id" FROM "stamp_condition"
  WHERE "abbreviation" = 'MNH'
  ORDER BY "collectionId", "sortOrder", "id"
);
