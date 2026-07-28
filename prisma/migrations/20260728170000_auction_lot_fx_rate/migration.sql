-- Base-currency FX rate frozen when a lot's outcome is recorded, at its closing date (#354).
--
-- The same mechanism `Purchase.fxRateToBase` uses at `purchasedAt` (ADR-0009 §4, #20), and stored
-- with the same precision as `exchange_rate.rate`. A lost lot is a *dated* price observation, so
-- the rate that applied when it closed has to travel with it: revaluing a 2023 result at today's
-- rate would make it report a price nobody ever paid.
--
-- Nullable, and null for three different reasons that all mean "nothing to convert with": the sale
-- is already in the base currency, no rate could be fetched, or the lot has no `finalPrice` at all.
ALTER TABLE "auction_lot" ADD COLUMN "fxRateToBase" DECIMAL(65,30);
