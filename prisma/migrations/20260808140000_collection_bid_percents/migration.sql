-- The percentages a bid recommendation is built from, per collection (#508; ADR-0029 §3, §4).
--
-- `bidFloorPercent` / `bidCeilingPercent` are the band stated around a lot's fair figure: below the
-- floor it is a bargain, past the ceiling it belongs to somebody else. They are a percentage of
-- `fair` rather than of the market's own spread, and the pair is deliberately not constrained to
-- straddle 100 — a collector who only buys at 40–60% of what a lot is worth is stating a trading
-- style, not making a mistake.
--
-- `bidFallbackPercent` is what a catalogue value is anchored at while the collection has no ratio
-- evidence at all (§2, bucket 5). The realization ratio itself is learned from recorded results
-- (#520), never configured. 100 keeps the pre-learning recommendation identical to what the
-- existing "ceiling <- catalogue value" quick fill (#370) already writes.
--
-- Defaults backfill every existing collection; no row means anything different from a new one.

ALTER TABLE "collection" ADD COLUMN "bidFloorPercent" INTEGER NOT NULL DEFAULT 75;
ALTER TABLE "collection" ADD COLUMN "bidCeilingPercent" INTEGER NOT NULL DEFAULT 125;
ALTER TABLE "collection" ADD COLUMN "bidFallbackPercent" INTEGER NOT NULL DEFAULT 100;
