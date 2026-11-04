-- A free extra (#2408): a copy the collector puts into the parcel for nothing, on top of what the
-- buyer bought. It is an ordinary sale line — the copy leaves the holdings on it, and its cost basis
-- counts against the sale's profit — priced at 0 and marked as one.
ALTER TABLE "sale_line" ADD COLUMN "freeExtra" BOOLEAN NOT NULL DEFAULT false;

-- A free extra is a set of copies on no offer (#2021) at price 0: what it gives away was picked from
-- stock, never sold through a listing, and nothing was paid for it.
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_free_extra_shape"
  CHECK (NOT "freeExtra" OR ("price" = 0 AND "offerSetId" IS NULL AND "offerId" IS NULL));
