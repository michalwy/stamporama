-- Multi-dimensional catalog prices (#91): a price is now keyed on
-- (stamp, edition, condition, certificate status) instead of one per stamp+edition.
--
-- Existing rows are dropped: this is non-production data and there is no
-- condition to map legacy prices onto. Requires PostgreSQL 15+ for the
-- `NULLS NOT DISTINCT` unique index (certificateStatusId is nullable and NULL
-- must count as a single "none" value for uniqueness).

DROP TABLE "stamp_catalog_price";

CREATE TABLE "stamp_catalog_price" (
    "id" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "catalogEditionId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "certificateStatusId" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "stamp_catalog_price_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stamp_catalog_price_unique"
    ON "stamp_catalog_price" ("stampId", "catalogEditionId", "conditionId", "certificateStatusId")
    NULLS NOT DISTINCT;

CREATE INDEX "stamp_catalog_price_stampId_idx" ON "stamp_catalog_price"("stampId");
CREATE INDEX "stamp_catalog_price_catalogEditionId_idx" ON "stamp_catalog_price"("catalogEditionId");
CREATE INDEX "stamp_catalog_price_conditionId_idx" ON "stamp_catalog_price"("conditionId");
CREATE INDEX "stamp_catalog_price_certificateStatusId_idx" ON "stamp_catalog_price"("certificateStatusId");

ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_catalogEditionId_fkey"
    FOREIGN KEY ("catalogEditionId") REFERENCES "catalog_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_certificateStatusId_fkey"
    FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
