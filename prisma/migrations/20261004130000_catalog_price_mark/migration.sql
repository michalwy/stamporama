-- A catalogue price cell can say the catalogue gives no price on purpose (#1615).
--
-- Catalogues list a stamp but print *—* where it does not exist in that condition, and *?* where its
-- price cannot be stated. Until now a cell held a price or nothing, so an empty cell could not tell
-- "the catalogue gives none" from "not entered yet", and every worklist kept asking for prices that
-- do not exist. A row now holds **either** a price **or** a mark:
--
--   nonexistent     the catalogue shows —
--   undeterminable  the catalogue shows ?
--
-- No row is still *not entered yet*. `currency` stays required: a marked row carries its catalogue's
-- currency like any other, so nothing reading the column has to learn a null. Existing rows are all
-- prices and satisfy both checks unchanged.
ALTER TABLE "stamp_catalog_price" ALTER COLUMN "price" DROP NOT NULL;
ALTER TABLE "stamp_catalog_price" ADD COLUMN "mark" TEXT;

ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_price_or_mark"
    CHECK (("price" IS NULL) <> ("mark" IS NULL));
ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_mark_value"
    CHECK ("mark" IS NULL OR "mark" IN ('nonexistent', 'undeterminable'));
