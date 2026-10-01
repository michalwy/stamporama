-- A lot's ceiling follows its bid unless it is set apart (#1515).
--
-- `auction_lot.maxBid` now holds only a ceiling chosen **separately** from the bid; null means the
-- ceiling is what the bid costs all-in, read through `ceilingOf` and never stored. No column changes,
-- only what an existing value says.
--
-- A stored ceiling that is already the bid's own — the two were set as one figure — becomes null, so
-- it follows the bid from now on. Two shapes count as "the bid's own", settled with the collector on
-- 2026-10-01:
--
--   * the ceiling **is** the bid's all-in (premium only, as a row costs a lot), to the cent;
--   * the bid **is** what *Bid my ceiling* would place inside it — the most whose all-in fits, rounded
--     down (`maxBidWithin`). That is the old REC → CEIL pair, whose ceiling sat a cent above the
--     bid's all-in purely from that rounding.
--
-- Every other stored ceiling is kept as a separate one, and the row shows it under the bid. A lot
-- with no bid keeps its ceiling: there is nothing for it to follow.
UPDATE "auction_lot" AS l
SET "maxBid" = NULL
FROM "auction_sale" AS s
WHERE l."auctionSaleId" = s."id"
  AND l."maxBid" IS NOT NULL
  AND l."myBid" IS NOT NULL
  AND (
    l."maxBid" = ROUND(
      l."myBid" * (1 + COALESCE(s."premiumPercent", 0) / 100) + COALESCE(s."premiumFixed", 0),
      2
    )
    OR (
      l."maxBid" > COALESCE(s."premiumFixed", 0)
      AND l."myBid" = FLOOR(
        (l."maxBid" - COALESCE(s."premiumFixed", 0)) / (1 + COALESCE(s."premiumPercent", 0) / 100) * 100
      ) / 100
    )
  );
