-- Auction lot: the outcome stops being recorded and starts being derived (ADR-0021 §4).
--
-- `status` held `watching | won | lost | cancelled`, which mixed two different things: where the lot
-- is in its life, and how the bidding went. The second one is not a fact the collector holds — it
-- follows from `myBid` (a proxy/maximum bid) against `finalPrice`, and `bidStanding` in
-- `auction-lot.ts` already computed exactly that arithmetic for the live case. Recording it by hand
-- is what allowed a lot filed `won` whose figures said it was outbid, with nothing to catch it.
--
-- What is left to record is the lifecycle: `open | closed | cancelled`. `closed` carries meaning the
-- old vocabulary could not express — the figures have been looked at and confirmed after the close —
-- which is precisely the state a lot sitting `watching` past its `endsAt` was standing in for.
--
-- The outcome now reads off the figures: no `myBid` = **observed** (the lot was tracked for its
-- price, never bid on — the case that started this and had nowhere to go), `finalPrice` below the
-- collector's maximum = **won**, above = **lost**.
--
-- Amounts are deliberately **not** backfilled. The figures stand as they were recorded, and a row
-- whose old status disagreed with them now reads as the figures say — which is the point.

ALTER TABLE "auction_lot" ADD COLUMN "wonTie" BOOLEAN;

-- The one thing that must be rescued before the old status loses its meaning.
--
-- At `finalPrice = myBid` the two real cases produce identical numbers: you bid your maximum first
-- and won, or somebody else bid the same maximum first and you lost. Bid order decides it, no column
-- holds it, and no arithmetic recovers it — so on these rows, and only these, the old status is the
-- sole surviving witness. Everywhere else `wonTie` stays null, where it means nothing.
UPDATE "auction_lot"
SET "wonTie" = ("status" = 'won')
WHERE "status" IN ('won', 'lost')
  AND "myBid" IS NOT NULL
  AND "finalPrice" IS NOT NULL
  AND "finalPrice" = "myBid";

-- `won` and `lost` collapse into one lifecycle state: both mean the auction ended and its figures
-- were confirmed. Which of the two it was is now read back out of those figures.
UPDATE "auction_lot"
SET "status" = CASE "status"
    WHEN 'watching' THEN 'open'
    WHEN 'won'      THEN 'closed'
    WHEN 'lost'     THEN 'closed'
    ELSE 'cancelled'
END;

ALTER TABLE "auction_lot" ALTER COLUMN "status" SET DEFAULT 'open';
