-- The collector's own estimate of how far a catalogue overstates what its stamps fetch (#1828;
-- ADR-0029 §2 as amended).
--
-- Catalogues overstate by very different amounts — a Michel figure ten times the realised price is
-- nothing unusual, Fischer typically runs two to five times — and until now one collection-wide
-- percentage (`bidFallbackPercent`) stood in for every catalogue while nothing had been learned. The
-- ratio stays learned from recorded results, and the catalogue becomes a bucket of the ladder; this
-- column is the rung beneath that bucket, used only when the catalogue's own results are too few.
--
-- Stored the way collectors speak of it — catalogue ÷ realised, `10` for "Michel runs ten times
-- high" — and applied as its inverse. NULL is "no factor", which is every existing row, and leaves
-- the ladder exactly as it was for that catalogue. The CHECK keeps a hand-edited row away from zero,
-- which the inverse cannot be taken of. No index: the figure is read with the catalogue, never
-- searched on.

ALTER TABLE "catalog_name"
  ADD COLUMN "manualFactor" DECIMAL(6, 2),
  ADD CONSTRAINT "catalog_name_manual_factor_positive"
    CHECK ("manualFactor" IS NULL OR "manualFactor" > 0);
