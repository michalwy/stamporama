-- Link to the transaction/order page on the marketplace for a sale (#292) — the sale-side
-- counterpart of `offer."url"` (#213/#214).
--
-- Nullable free text, stored exactly as pasted (trimmed only): a platform's order URL has no
-- shape worth validating, and a collector reconciling against the marketplace wants the link
-- they were given. No backfill — an existing sale simply has no link recorded.

ALTER TABLE "sale" ADD COLUMN "transactionUrl" TEXT;
