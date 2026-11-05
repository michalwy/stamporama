-- Check Colnect market (#2454): the Assistant reads what Colnect's marketplace asks for an offer's
-- stamps, in every condition, and a click prices the offer just under one of those prices.
--
-- The last read is kept **with the offer** until the next one replaces it: what was read, when. It is
-- not a price observation and counts towards nothing (#1633) — Market stays the realised-price
-- figure — so it is one JSON document on the offer rather than rows anything else could query. Its
-- shape is `colnect-market-rules.ts`'s `StoredColnectMarketRead`, versioned inside the document.
--
-- The **step** a click undercuts by is the Colnect platform's, in the platform's currency. Null is
-- the default step, 0.01 — stated in code rather than written into every collection's row.

ALTER TABLE "offer" ADD COLUMN "colnectMarketRead" JSONB;
ALTER TABLE "offer" ADD COLUMN "colnectMarketReadAt" TIMESTAMP(3);

ALTER TABLE "platform" ADD COLUMN "marketPriceStep" DECIMAL(10,2);
ALTER TABLE "platform" ADD CONSTRAINT "platform_market_price_step_positive"
  CHECK ("marketPriceStep" IS NULL OR "marketPriceStep" > 0);
