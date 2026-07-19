-- Per-stamp override of the subtype's actsAsVariant behaviour (ADR-0010). Nullable
-- tri-state: NULL = inherit from the subtype (default, preserves current behaviour),
-- true/false = force. The effective value used by valuation / umbrella / completeness
-- is `actsAsVariantOverride` when set, otherwise the subtype's `actsAsVariant`.
-- No backfill: existing children keep NULL and thus inherit their subtype exactly as
-- before.
ALTER TABLE "stamp" ADD COLUMN "actsAsVariantOverride" BOOLEAN;
