-- A condition can be a price column only (#2374).
--
-- Catalogues print cover prices as columns beside the loose ones — Michel's ⊠ EF / MeF / MiF and
-- Bfst, Fischer's ⊠ or FP / FW / FM. The collector types them as conditions of their own, so a
-- catalogue row goes straight across the price grid; but no copy is ever *in* such a condition, so
-- one marked here is a column on every price surface and in no picker that sets what a copy, a want,
-- a line or any other record is. Every existing condition stays what it was.

ALTER TABLE "stamp_condition" ADD COLUMN "priceOnly" BOOLEAN NOT NULL DEFAULT false;
