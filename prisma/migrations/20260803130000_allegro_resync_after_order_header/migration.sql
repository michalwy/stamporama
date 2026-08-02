-- Make the next Allegro pass a full re-import (#467; ADR-0024).
--
-- The previous migration cleared `allegro_order_line` when the order header was split out of it, on
-- the reasoning that every row there is an observation the sync rewrites. That is true — but only if
-- the sync actually reads those orders again, and it would not have: `orderCursor` still pointed at
-- the newest event already seen, so the next pass would have followed the stream forward from there
-- and re-imported nothing. The worklist would have come back empty and stayed empty.
--
-- Clearing the cursor puts the sync back in its first-sync shape: it reads the last 30 days of
-- orders through the dated window and mints a fresh cursor from the event stream before doing so.
-- Safe to run whatever state a collection was in, because every write the sync makes is an upsert on
-- Allegro's own ids — the worst case is one pass costing a few extra requests.
--
-- `listingsSweptAt` is deliberately left alone: the listing sweep never depended on the cursor, and
-- the ended-without-selling rows it had already worked out are still true.
UPDATE "allegro_sync_state"
SET "orderCursor" = NULL,
    "ordersSyncedAt" = NULL;
