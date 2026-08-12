-- When a listing was closed (#512), so the sweep that purges a closed offer's generated images
-- knows how long it has been over. `state` alone cannot say that, and the offer's own timestamps
-- move for reasons that have nothing to do with the listing ending.
--
-- Existing closed offers are backfilled with `now()` rather than with a guess at when they actually
-- closed: nothing recorded that date, and dating them from `createdAt` would purge a whole archive's
-- images in the first sweep after the upgrade. Starting the clock at the migration gives every
-- already-closed listing the same grace period a newly closed one gets.

ALTER TABLE "offer" ADD COLUMN "closedAt" TIMESTAMP(3);

UPDATE "offer" SET "closedAt" = now() WHERE "state" IN ('sold', 'withdrawn');

CREATE INDEX "offer_state_closedAt_idx" ON "offer"("state", "closedAt");
