-- Offer: auction or quick-buy, and the two prices an auction has (#449).
--
-- `listingType` is a fact about the *listing*, not about the platform: a marketplace that runs both
-- formats (Allegro, Delcampe) carries offers of either kind, so it cannot be read off the platform
-- contact. Every existing offer is a fixed-price listing — that is the only thing the app has been
-- able to express — hence the default, which also makes the backfill a no-op.
--
-- `price` deliberately keeps its column and gains a second reading rather than being split in two:
-- on an auction it is the **current** figure (the standing bid, or the opening price while nobody
-- has bid). Everything already reading it — the list rows, the base-currency conversion (#208), the
-- suggested-price comparison (#190), the ready/active price gate (#336), the listing kit (#405) and
-- the sale flow — wants the live number, and would have needed a per-type branch for no gain if the
-- starting price had taken it over. The opening figure is a record and gets its own nullable column.
--
-- `priceCheckedAt` is the auction lot's `checkedAt` (#351) on an offer: refreshing a bid is manual
-- by decision (ADR-0021 §8), so a stored figure is only worth what its age says. Null everywhere
-- until a price is next edited — including on every fixed-price listing, where nothing moves the
-- number behind the seller's back and there is nothing to re-check.

ALTER TABLE "offer" ADD COLUMN "listingType" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "offer" ADD COLUMN "startingPrice" DECIMAL(10,2);
ALTER TABLE "offer" ADD COLUMN "priceCheckedAt" TIMESTAMP(3);
