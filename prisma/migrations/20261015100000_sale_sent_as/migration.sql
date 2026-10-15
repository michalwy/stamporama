-- A sale records the carrier service its parcel was actually sent with (#1923), beside the buyer's
-- shipping option. Null means "as the option": the service the option is linked to, which is how
-- every sale recorded before this reads, so nothing is backfilled.
ALTER TABLE "sale" ADD COLUMN "sentAsServiceId" TEXT;

CREATE INDEX "sale_sentAsServiceId_idx" ON "sale"("sentAsServiceId");

-- A service a sale was sent as cannot be deleted, the guard the option's link carries.
ALTER TABLE "sale" ADD CONSTRAINT "sale_sentAsServiceId_fkey"
    FOREIGN KEY ("sentAsServiceId") REFERENCES "carrier_service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
