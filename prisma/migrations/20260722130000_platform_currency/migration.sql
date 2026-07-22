-- Per-platform currency (#196). A platform (a `contact` carrying the `platform` role) has a fixed
-- transaction currency that every offer and sale routed to it inherits and locks. Nullable — only
-- platforms use it, and it is required (domain-enforced, not a DB constraint) before the first
-- offer/sale on that platform. Existing offers/sales keep their own `currency` snapshot, so
-- changing this later never rewrites history.

ALTER TABLE "contact" ADD COLUMN "platformCurrency" TEXT;
