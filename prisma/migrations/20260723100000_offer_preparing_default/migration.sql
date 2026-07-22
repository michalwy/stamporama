-- A new offer now starts in the `preparing` state (composed but not yet published); it is
-- activated by hand (#188). Existing rows keep their current state — only the column default
-- changes, so no data is rewritten.
ALTER TABLE "offer" ALTER COLUMN "state" SET DEFAULT 'preparing';
