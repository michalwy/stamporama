-- The bid the collector has actually placed at the platform (a proxy/maximum bid), as opposed to
-- `currentBid` (what the lot stands at) and `maxBid` (what it is privately worth to them).
--
-- Nullable: most watched lots have not been bid on at all. Whether the collector is leading or has
-- been outbid is derived from this against `currentBid` and is deliberately not stored — a flag
-- would need keeping current by hand and would go stale the moment the bid moves.
ALTER TABLE "auction_lot" ADD COLUMN "myBid" DECIMAL(10,2);
