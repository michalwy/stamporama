-- Each valuation method maps the roles it reads to the collection's conditions (#2375; ADR-0077).
--
-- #2356 stored a stamp's prices on cover and on piece as four reserved formats — Cover EF, Cover MeF,
-- Cover MiF, On piece — that the collector could not name, abbreviate or translate, although a
-- catalogue prints them as columns, the way it prints ** and ⊙. They are now conditions the collector
-- defines (a price column only, #2374), and each method is told which condition plays each role:
--
--   * michel           — used, cover_ef, cover_mef, cover_mif, on_piece, never_hinged;
--   * fischer          — used, cover (⊠), on_piece;
--   * fischer_fp_fw_fm — used, fp, fw, fm, on_piece;
--   * sum_of_used      — used.
--
-- A role with no row is not set up: a piece's value is then partial and says so. Deleting the
-- condition unmaps the role.
--
-- **Nothing is created in place of what goes**: no conditions, no mappings, no prices moved — the
-- collector sets them up. The reserved formats go with their prices and multipliers, and the
-- conditions' `priceRole` with them: Michel's rule for stamps still valid for postage (#2358) reads
-- the conditions the Michel method maps as used and never hinged.

CREATE TABLE "valuation_method_role" (
  "id" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "conditionId" TEXT NOT NULL,
  CONSTRAINT "valuation_method_role_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "valuation_method_role_pair_check" CHECK (
    ("method" = 'michel' AND "role" IN ('used', 'cover_ef', 'cover_mef', 'cover_mif', 'on_piece', 'never_hinged'))
    OR ("method" = 'fischer' AND "role" IN ('used', 'cover', 'on_piece'))
    OR ("method" = 'fischer_fp_fw_fm' AND "role" IN ('used', 'fp', 'fw', 'fm', 'on_piece'))
    OR ("method" = 'sum_of_used' AND "role" = 'used')
  )
);

CREATE UNIQUE INDEX "valuation_method_role_collectionId_method_role_key"
  ON "valuation_method_role"("collectionId", "method", "role");
CREATE INDEX "valuation_method_role_conditionId_idx" ON "valuation_method_role"("conditionId");

ALTER TABLE "valuation_method_role"
  ADD CONSTRAINT "valuation_method_role_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "valuation_method_role_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The reserved formats, their prices and their multipliers. No copy, want or line can be in one
-- (every such check refused them), so nothing else refers to them.

DELETE FROM "stamp_catalog_price"
 WHERE "formatId" IN (SELECT "id" FROM "stamp_format" WHERE "coverKind" IS NOT NULL);

DELETE FROM "stamp_format_factor"
 WHERE "formatId" IN (SELECT "id" FROM "stamp_format" WHERE "coverKind" IS NOT NULL);

DELETE FROM "stamp_format" WHERE "coverKind" IS NOT NULL;

ALTER TABLE "stamp_format" DROP CONSTRAINT "stamp_format_piece_kind_check";
ALTER TABLE "stamp_format" DROP CONSTRAINT "stamp_format_coverKind_check";
DROP INDEX "stamp_format_collectionId_coverKind_key";
ALTER TABLE "stamp_format" DROP COLUMN "coverKind";
ALTER TABLE "stamp_format" ADD CONSTRAINT "stamp_format_piece_kind_check"
  CHECK ("pieceKind" IS NULL OR "pieceKind" IN ('on_cover', 'on_piece'));

DROP INDEX "stamp_condition_collectionId_priceRole_key";
ALTER TABLE "stamp_condition" DROP CONSTRAINT "stamp_condition_priceRole_check";
ALTER TABLE "stamp_condition" DROP COLUMN "priceRole";
