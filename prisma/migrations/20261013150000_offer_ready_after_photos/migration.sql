-- Mark ready generates the listing photos when their absence is what blocks it (#1893). The offer
-- waits for the run and turns Ready by itself once its photos are done, if nothing else stands in
-- the way.
--
-- `readyAfterPhotosAt` is set while it waits; `readyAfterPhotosRefusal` says why the last wait did
-- not end in Ready. Both start empty: no offer is waiting today.

ALTER TABLE "offer" ADD COLUMN "readyAfterPhotosAt" TIMESTAMP(3);
ALTER TABLE "offer" ADD COLUMN "readyAfterPhotosRefusal" TEXT;
