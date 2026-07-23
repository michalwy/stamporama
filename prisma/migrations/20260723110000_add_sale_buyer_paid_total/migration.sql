-- The buyer-paid total, when it (not handling) is the anchor for buyer-side proceeds (#205).
-- Nullable: existing sales stay handling-anchored (this stays NULL). At most one of
-- "buyerHandling" / "buyerPaidTotal" is non-null per sale.
ALTER TABLE "sale" ADD COLUMN "buyerPaidTotal" DECIMAL(10,2);
