-- Automatic "in active bidding" from the Allegro sync (#481).
--
-- The sweep the sold-listing sync already runs (`GET /sale/offers`, #467) states the selling format
-- and, on an auction, how many people have bid and what the standing bid is. Those three facts cost
-- no extra request, and they are what turns #215's flag from something the collector notices into
-- something the app reports.
--
-- Recorded on **both** sides. `allegro_listing` keeps the platform's own words — what Allegro said,
-- beside the `observedAt` that already says when. `offer` keeps the reading the collector's screens
-- are written against: the standing bid in `price`, dated by `priceCheckedAt`, with the bidder count
-- beside it.

-- What the sweep saw of the bidding. `format` is recorded rather than inferred from the local
-- offer's `listingType`: the two can disagree, and which one the marketplace is running is Allegro's
-- to say. `currentCurrency` rides beside the amount because a price without its currency is not one.
ALTER TABLE "allegro_listing" ADD COLUMN "format" TEXT;
ALTER TABLE "allegro_listing" ADD COLUMN "biddersCount" INTEGER;
ALTER TABLE "allegro_listing" ADD COLUMN "currentPrice" DECIMAL(10,2);
ALTER TABLE "allegro_listing" ADD COLUMN "currentCurrency" TEXT;

-- How many bidders a connected platform reported on this auction, as of `priceCheckedAt`. Written
-- only by a sync and never by hand, so its presence is the provenance of the figure beside it — a
-- bid this app observed rather than one typed in. Nullable everywhere, including on every offer that
-- exists today: no sync has looked at them yet, and `0` means the opposite (looked at, unbid).
ALTER TABLE "offer" ADD COLUMN "bidderCount" INTEGER;

-- The bidding poll's own cursor and dates (#481). A bid has to be acted on in minutes, and sweeping
-- every listing that often to discover that nothing changed would spend the account's quota to learn
-- nothing — so the poll follows Allegro's offer event stream (`GET /sale/offer-events`,
-- `OFFER_BID_PLACED` / `OFFER_BID_CANCELED`) and reads details only for the offers named there.
--
-- `eventPollError` is deliberately not `lastError`: a failing bid poll must not make the sold-listing
-- worklist read as stale, nor the other way round.
ALTER TABLE "allegro_sync_state" ADD COLUMN "offerEventCursor" TEXT;
ALTER TABLE "allegro_sync_state" ADD COLUMN "eventPolledAt" TIMESTAMP(3);
ALTER TABLE "allegro_sync_state" ADD COLUMN "eventPollError" TEXT;
