-- A sale's free-text note (#2379): the collector's own remark, private to them. Null when none.
ALTER TABLE "sale" ADD COLUMN "note" TEXT;
