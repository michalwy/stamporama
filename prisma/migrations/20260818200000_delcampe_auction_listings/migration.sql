-- Auction-type Delcampe listings (#620; ADR-0034 §7).
--
-- A second duration group on the listing profile, and deliberately not a reinterpretation of the
-- first: `renewDuration` × `renewTotalCount` (28 × 99) is shop stock — a fixed-price listing that
-- stays up until it sells — while an auction's whole point is a deadline. An auction row takes
-- `renew_duration` and `renew_total_count` from these columns instead.
--
-- **Nullable and seeded with nothing.** Every other default on this table was observed on the
-- collector's own live listings; there are no auctions to observe, so a figure here would be this
-- app inventing how long somebody's auctions run. The export refuses an auction row while they are
-- null and says which are missing.
ALTER TABLE "delcampe_listing_profile"
    ADD COLUMN "auctionDuration" INTEGER,
    ADD COLUMN "auctionRenewTotalCount" INTEGER,
    -- `sale_end_day` / `sale_end_time`, stored and written **verbatim** — ADR-0034 §2's treatment of
    -- `shippingModel` applied to a second unvalidatable cell. What spelling Easy Uploader wants for
    -- a closing day and hour is published nowhere this app can read and has never been confirmed, so
    -- a picker would be a claim about that format and a wrong one would need a release to correct.
    -- Empty is allowed and means the row states no end.
    ADD COLUMN "auctionEndDay" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "auctionEndTime" TEXT NOT NULL DEFAULT '';
