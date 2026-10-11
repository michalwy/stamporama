-- When a purchase's status last changed (#1810), so the dashboard can say how long an order has been
-- in transit, or arrived and not yet sorted, and list the oldest first. The app writes it only when
-- the status really changes, never when an edit restates the same status. Documents that already
-- exist have no record of when their status changed, so their purchase date stands in until their
-- status next changes — decided with the collector on 2026-10-11.
ALTER TABLE "purchase" ADD COLUMN "statusChangedAt" TIMESTAMP(3);
UPDATE "purchase" SET "statusChangedAt" = "purchasedAt";
ALTER TABLE "purchase" ALTER COLUMN "statusChangedAt" SET NOT NULL;
ALTER TABLE "purchase" ALTER COLUMN "statusChangedAt" SET DEFAULT CURRENT_TIMESTAMP;
