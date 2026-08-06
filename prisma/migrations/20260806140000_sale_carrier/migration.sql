-- Who carried **this** parcel (#491), beside the number it went under.
--
-- The migration before this one gave the shipping method a carrier and left it at that, which reads
-- the marketplace's own vocabulary too literally: on Allegro the buyer picks a *service* — "Courier"
-- — and which courier it actually goes with is decided days later at the parcel counter. So the
-- carrier on the method is a **default**, and the sale needs an answer of its own.
--
-- Null means the sale never said, and the read falls back to the method's carrier — which is exactly
-- what "the method's carrier is a default" amounts to, without a backfill inventing a courier for
-- every parcel already sent. Written by the prompt shown while a sale is marked `sent`, where the
-- method's carrier arrives pre-selected and can be changed.
--
-- RESTRICT, like every other dictionary reference here: a carrier a sale names cannot be deleted out
-- from under the record of what carried it.
ALTER TABLE "sale" ADD COLUMN "carrierId" TEXT;

CREATE INDEX "sale_carrierId_idx" ON "sale"("carrierId");

ALTER TABLE "sale" ADD CONSTRAINT "sale_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
