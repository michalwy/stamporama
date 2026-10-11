-- When an offer entered the state it is in (#1811), so the Dashboard's *Offers to handle* can say how
-- long a Ready offer has waited to be published and a Pending one for its administrator. The app
-- stamps it on every write that changes `state`; the default covers a create.
--
-- Nothing recorded the moment before now, so existing offers get the best date they already carry:
-- a closed one its closing date (#512), a live one its listing date (#257) — reposting never changes
-- the state, so the first listing is when it went up — and everything else, Pending included, its
-- creation. An estimate for those offers; exact for every change from here on.
ALTER TABLE "offer" ADD COLUMN "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "offer" SET "stateChangedAt" = CASE
  WHEN "state" IN ('sold', 'withdrawn') THEN COALESCE("closedAt", "createdAt")
  WHEN "state" IN ('active', 'paused') THEN COALESCE("listingDate"::timestamp(3), "createdAt")
  ELSE "createdAt"
END;
