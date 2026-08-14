-- Closed-offer photo retention moves onto the collection (#577). A working collection and an
-- archive of something finished want different answers, and an environment variable can only give
-- one for the whole instance.
--
-- The column holds exactly what `STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS` holds — `off`/`never` for
-- keep for ever, `0` to purge at the next sweep, otherwise days — so the one parser that already
-- reads that grammar reads this too.
--
-- Deliberately **not** backfilled from the environment variable. Null means *no opinion*, which
-- defers to the environment and then to the built-in seven days, so an instance that set the
-- variable and touches nothing keeps behaving exactly as it does today — and an operator who later
-- changes the variable still moves every collection that never stated its own answer.

ALTER TABLE "collection" ADD COLUMN "closedOfferPhotoTtlDays" TEXT;
