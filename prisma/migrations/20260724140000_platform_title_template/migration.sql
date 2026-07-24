-- Add the per-platform title template (#210): a free-text template with {tokens} that pre-fills the
-- offer name (#209) and set/lot titles for listings on this platform. Nullable — platforms without a
-- configured template fall back to the built-in default template.
ALTER TABLE "contact" ADD COLUMN "titleTemplate" TEXT;
