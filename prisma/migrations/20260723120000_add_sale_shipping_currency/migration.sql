-- My shipping cost can be entered in any currency, converted straight to the base currency (#206).
-- `shippingCost` becomes the original amount in `shippingCurrency`; `shippingFxRateToBase` freezes
-- that currency's base rate at the sale date.
ALTER TABLE "sale" ADD COLUMN "shippingCurrency" TEXT;
ALTER TABLE "sale" ADD COLUMN "shippingFxRateToBase" DECIMAL(65,30);

-- Existing sales stored shipping in the sale's transaction currency, so backfill that currency and
-- reuse the sale's frozen base rate (shipping currency == sale currency, so their base rates match).
UPDATE "sale"
SET "shippingCurrency" = "currency",
    "shippingFxRateToBase" = "fxRateToBase"
WHERE "shippingCost" IS NOT NULL;
