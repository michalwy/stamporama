-- Daily collection value snapshots (#652, ADR-0053).
--
-- The value of the holdings on a past day is not recoverable from current state: catalogue prices,
-- the copies held, the offers on the market and the rates all move, and nothing kept what they were.
-- Growth in copies and spend is derivable from event dates and needs none of this.
--
-- Two tables rather than one with a nullable area: `(collectionId, day)` and `(snapshotId, areaId)`
-- are both real unique keys, where a single table's `(collectionId, areaId, day)` would let Postgres
-- hold any number of collection rows for one day (NULLs are distinct) — and "a restart does not
-- double a point" is the requirement.
--
-- Money is in the collection's base currency. `rates` is the collection's exchange-rate table at the
-- moment of the pass, restated into that base (`{ "EUR": 4.25, ... }`), and `ratesFetchedAt` the
-- date of that table — null when the collection holds none. A snapshot has to stay readable after
-- rates move; re-converting history at today's rate would be a different claim.
--
-- Asking value and auction exposure are collection-level only: an offer or a lot can mix copies of
-- several areas, so neither splits cleanly by area (settled with the collector on #652).

CREATE TABLE "collection_value_snapshot" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "ratesFetchedAt" TIMESTAMP(3),
    "catalogueValue" DECIMAL(14,2) NOT NULL,
    "catalogueUncertainValue" DECIMAL(14,2) NOT NULL,
    "cataloguePricedCount" INTEGER NOT NULL,
    "catalogueUnpricedCount" INTEGER NOT NULL,
    "catalogueUnconvertibleCount" INTEGER NOT NULL,
    "catalogueUncertainCount" INTEGER NOT NULL,
    "marketValue" DECIMAL(14,2) NOT NULL,
    "marketValuedCount" INTEGER NOT NULL,
    "marketNoEvidenceCount" INTEGER NOT NULL,
    "acquisitionCost" DECIMAL(14,2) NOT NULL,
    "costKnownCount" INTEGER NOT NULL,
    "costPendingCount" INTEGER NOT NULL,
    "costNoneCount" INTEGER NOT NULL,
    "copiesHeld" INTEGER NOT NULL,
    "askingValue" DECIMAL(14,2) NOT NULL,
    "askingOfferCount" INTEGER NOT NULL,
    "askingUnpricedCount" INTEGER NOT NULL,
    "askingUnconvertibleCount" INTEGER NOT NULL,
    "exposureCommitted" DECIMAL(14,2) NOT NULL,
    "exposureCeiling" DECIMAL(14,2) NOT NULL,
    "exposurePayableCount" INTEGER NOT NULL,
    "exposureUncappedCount" INTEGER NOT NULL,
    "exposureUnconvertibleCount" INTEGER NOT NULL,

    CONSTRAINT "collection_value_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collection_value_snapshot_collectionId_day_key"
    ON "collection_value_snapshot"("collectionId", "day");

ALTER TABLE "collection_value_snapshot" ADD CONSTRAINT "collection_value_snapshot_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "collection_area_value_snapshot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "collectionAreaId" TEXT NOT NULL,
    "catalogueValue" DECIMAL(14,2) NOT NULL,
    "catalogueUncertainValue" DECIMAL(14,2) NOT NULL,
    "cataloguePricedCount" INTEGER NOT NULL,
    "catalogueUnpricedCount" INTEGER NOT NULL,
    "catalogueUnconvertibleCount" INTEGER NOT NULL,
    "catalogueUncertainCount" INTEGER NOT NULL,
    "marketValue" DECIMAL(14,2) NOT NULL,
    "marketValuedCount" INTEGER NOT NULL,
    "marketNoEvidenceCount" INTEGER NOT NULL,
    "acquisitionCost" DECIMAL(14,2) NOT NULL,
    "costKnownCount" INTEGER NOT NULL,
    "costPendingCount" INTEGER NOT NULL,
    "costNoneCount" INTEGER NOT NULL,
    "copiesHeld" INTEGER NOT NULL,

    CONSTRAINT "collection_area_value_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collection_area_value_snapshot_snapshotId_collectionAreaId_key"
    ON "collection_area_value_snapshot"("snapshotId", "collectionAreaId");
CREATE INDEX "collection_area_value_snapshot_collectionAreaId_idx"
    ON "collection_area_value_snapshot"("collectionAreaId");

ALTER TABLE "collection_area_value_snapshot" ADD CONSTRAINT "collection_area_value_snapshot_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "collection_value_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_area_value_snapshot" ADD CONSTRAINT "collection_area_value_snapshot_collectionAreaId_fkey"
    FOREIGN KEY ("collectionAreaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
