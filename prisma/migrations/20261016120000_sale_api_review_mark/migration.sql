-- Sales written through the agent API carry a *to review* marker (#1948), as auction lots and sales
-- already do (#1626).
--
-- A sale an agent records — read off a marketplace thread, matched to a buyer by name — can be
-- wrong in ways the collector would catch at a glance, so it stays visibly waiting until the
-- collector has looked at it. Every API write sets the marker and only the collector's *Confirm*
-- clears it; editing the sale in the app leaves it standing, because reviewing is a deliberate act.
--
--   apiReviewAt       the latest API write since the last confirm; NULL means no marker at all
--   apiReviewCreated  the API recorded the sale (rather than only adding to one)
--   apiReviewActions  what the API did, worded by the code that wrote it, accumulated until confirmed
--
-- Nothing existing was written through the API — the agent API has no sale writes yet (#1949) — so
-- every row starts unmarked.
ALTER TABLE "sale" ADD COLUMN "apiReviewAt" TIMESTAMP(3);
ALTER TABLE "sale" ADD COLUMN "apiReviewCreated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale" ADD COLUMN "apiReviewActions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The sales list filters by the marker, and the Action items bell counts it.
CREATE INDEX "sale_apiReviewAt_idx" ON "sale"("apiReviewAt");
