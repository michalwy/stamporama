-- A morning email of the watched auction lots ending that day (#1373).
--
-- Four settings on the collection, beside the bid percentages it already carries:
--
-- - `auctionReminderEnabled` — off by default; it cannot be switched on while the instance has no
--   mail provider (#1372), which the writer checks, not this table.
-- - `auctionReminderHour` — the hour of the collector's day it goes at, 0–23, 08:00 by default.
-- - `auctionReminderTimeZone` — the IANA zone that hour and "today" are read in. Null until the
--   reminder is first switched on, when the Settings page fills it from the browser; the app knew no
--   zone of the collector's before this, and a container's clock is usually UTC.
-- - `auctionReminderLastDay` — the collector's calendar day the reminder was last done for, whether
--   an email went out or there was nothing to send. It is what makes the reminder go once a day: the
--   sweep claims the day by moving this column, in the same transaction that queues the message.

ALTER TABLE "collection" ADD COLUMN "auctionReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "collection" ADD COLUMN "auctionReminderHour" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "collection" ADD COLUMN "auctionReminderTimeZone" TEXT;
ALTER TABLE "collection" ADD COLUMN "auctionReminderLastDay" DATE;

ALTER TABLE "collection"
  ADD CONSTRAINT "collection_auctionReminderHour_check"
    CHECK ("auctionReminderHour" BETWEEN 0 AND 23);

-- Switched on means a zone is known: without one "today" means nothing.
ALTER TABLE "collection"
  ADD CONSTRAINT "collection_auctionReminderTimeZone_check"
    CHECK (NOT "auctionReminderEnabled" OR "auctionReminderTimeZone" IS NOT NULL);
