-- Carriers and their rate lists are global; a platform only offers shipping options (#1909,
-- ADR-0069).
--
-- Until now each platform kept its own shipping methods with what each cost the collector (#468), so
-- the same registered letter was priced once on Allegro, again on Colnect, again on Facebook. The
-- cost of sending a letter has nothing to do with where the stamp sold. So:
--
--   carrier                 the collector's carriers (#491), unchanged, now with a rate list
--   carrier_service         one service of a carrier and what it costs the collector — new
--   carrier_service_supply  a service's usual packing supplies — moved from the shipping method
--   shipping_option         the old `shipping_method`, renamed: what a platform offers its buyers,
--                           at the **buyer's** price, linked to at most one carrier service
--
-- Existing data moves over, nothing lost (the collector's decisions of 2026-10-14, on the issue):
--
-- - Every shipping method becomes its platform's shipping option, with the same name; its buyer
--   price is its old cost, which is what `{shippingOptions}` showed buyers until now.
-- - Each distinct carrier, name, cost, currency **and default supply list** among the methods becomes
--   one carrier service, linked from every option it came from, and keeps the supply list. A method
--   that named a carrier puts its service under that carrier; one that did not, under an
--   *Unassigned* carrier made for the purpose, for the collector to sort into real ones. The supply
--   list is part of the key so two methods that merged into one service could not lose either list.
-- - A carrier's service names are its pick-list and unique within it. Where two services would share
--   a name under one carrier (*registered letter* priced differently on two platforms), each is named
--   with its cost after it — *registered letter — 12.00 PLN* — and, should even that collide (same
--   cost, different supplies), numbered.
-- - A sale's option and its snapshot name keep their values under the new column names. Its postage
--   was always a copy, so it is untouched.

-- ── 1. The carrier's rate list ──────────────────────────────────────────────────────────────────

CREATE TABLE "carrier_service" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_service_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "carrier_service_carrierId_name_key" ON "carrier_service"("carrierId", "name");
CREATE INDEX "carrier_service_collectionId_idx" ON "carrier_service"("collectionId");
CREATE INDEX "carrier_service_carrierId_idx" ON "carrier_service"("carrierId");

ALTER TABLE "carrier_service" ADD CONSTRAINT "carrier_service_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A carrier with services cannot be deleted: its services go first.
ALTER TABLE "carrier_service" ADD CONSTRAINT "carrier_service_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "carrier_service_supply" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "carrier_service_supply_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "carrier_service_supply_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "carrier_service_supply_serviceId_supplyId_key"
    ON "carrier_service_supply"("serviceId", "supplyId");
CREATE INDEX "carrier_service_supply_supplyId_idx" ON "carrier_service_supply"("supplyId");

ALTER TABLE "carrier_service_supply" ADD CONSTRAINT "carrier_service_supply_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "carrier_service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carrier_service_supply" ADD CONSTRAINT "carrier_service_supply_supplyId_fkey"
    FOREIGN KEY ("supplyId") REFERENCES "packing_supply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Move the methods' costs into services ────────────────────────────────────────────────────

-- The *Unassigned* carrier, only in a collection that has a method naming no carrier. A carrier the
-- collector already called that is reused rather than duplicated.
INSERT INTO "carrier" ("id", "collectionId", "name")
SELECT gen_random_uuid()::text, m."collectionId", 'Unassigned'
FROM "shipping_method" m
WHERE m."carrierId" IS NULL
GROUP BY m."collectionId"
ON CONFLICT ("collectionId", "name") DO NOTHING;

-- Each method with the carrier its service goes under and its supply list as one comparable string.
CREATE TEMPORARY TABLE "_method_key" AS
SELECT
    m."id" AS "methodId",
    m."collectionId",
    COALESCE(m."carrierId", u."id") AS "carrierId",
    m."name",
    m."cost",
    m."currency",
    COALESCE(
        (SELECT string_agg(s."supplyId" || ':' || s."quantity", ',' ORDER BY s."supplyId")
         FROM "shipping_method_supply" s WHERE s."methodId" = m."id"),
        ''
    ) AS "supplies"
FROM "shipping_method" m
LEFT JOIN "carrier" u ON u."collectionId" = m."collectionId" AND u."name" = 'Unassigned';

-- One service per distinct key, named as the header says.
CREATE TEMPORARY TABLE "_service" AS
WITH "groups" AS (
    SELECT DISTINCT "collectionId", "carrierId", "name", "cost", "currency", "supplies"
    FROM "_method_key"
),
"counted" AS (
    SELECT g.*,
        COUNT(*) OVER (PARTITION BY "carrierId", "name") AS "sameName",
        COUNT(*) OVER (PARTITION BY "carrierId", "name", "cost", "currency") AS "samePrice",
        ROW_NUMBER() OVER (PARTITION BY "carrierId", "name", "cost", "currency" ORDER BY "supplies")
            AS "n"
    FROM "groups" g
)
SELECT
    gen_random_uuid()::text AS "id",
    "collectionId", "carrierId", "cost", "currency", "supplies",
    "name" AS "methodName",
    CASE
        WHEN "sameName" = 1 THEN "name"
        WHEN "samePrice" = 1 THEN "name" || ' — ' || "cost"::text || ' ' || "currency"
        ELSE "name" || ' — ' || "cost"::text || ' ' || "currency" || ' (' || "n" || ')'
    END AS "name"
FROM "counted";

INSERT INTO "carrier_service" ("id", "collectionId", "carrierId", "name", "cost", "currency")
SELECT "id", "collectionId", "carrierId", "name", "cost", "currency" FROM "_service";

-- A service's supplies are its key's list, read off any one of the methods that share it.
INSERT INTO "carrier_service_supply" ("id", "serviceId", "supplyId", "quantity")
SELECT gen_random_uuid()::text, sv."id", ms."supplyId", ms."quantity"
FROM "_service" sv
JOIN LATERAL (
    SELECT k."methodId" FROM "_method_key" k
    WHERE k."carrierId" = sv."carrierId" AND k."name" = sv."methodName" AND k."cost" = sv."cost"
      AND k."currency" = sv."currency" AND k."supplies" = sv."supplies"
    LIMIT 1
) one ON TRUE
JOIN "shipping_method_supply" ms ON ms."methodId" = one."methodId";

-- ── 3. The method becomes the platform's shipping option ────────────────────────────────────────

ALTER TABLE "shipping_method" RENAME TO "shipping_option";
ALTER TABLE "shipping_option" RENAME CONSTRAINT "shipping_method_pkey" TO "shipping_option_pkey";
ALTER TABLE "shipping_option" RENAME CONSTRAINT "shipping_method_collectionId_fkey"
    TO "shipping_option_collectionId_fkey";
ALTER TABLE "shipping_option" RENAME CONSTRAINT "shipping_method_platformId_fkey"
    TO "shipping_option_platformId_fkey";
ALTER INDEX "shipping_method_platformId_name_key" RENAME TO "shipping_option_platformId_name_key";
ALTER INDEX "shipping_method_collectionId_idx" RENAME TO "shipping_option_collectionId_idx";
ALTER INDEX "shipping_method_platformId_idx" RENAME TO "shipping_option_platformId_idx";

-- What was the collector's cost is now the buyer's price (the collector's decision, above).
ALTER TABLE "shipping_option" RENAME COLUMN "cost" TO "price";

ALTER TABLE "shipping_option" ADD COLUMN "serviceId" TEXT;

UPDATE "shipping_option" o
SET "serviceId" = sv."id"
FROM "_method_key" k
JOIN "_service" sv
  ON sv."carrierId" = k."carrierId" AND sv."methodName" = k."name" AND sv."cost" = k."cost"
 AND sv."currency" = k."currency" AND sv."supplies" = k."supplies"
WHERE k."methodId" = o."id";

CREATE INDEX "shipping_option_serviceId_idx" ON "shipping_option"("serviceId");

ALTER TABLE "shipping_option" ADD CONSTRAINT "shipping_option_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "carrier_service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The carrier now comes from the service.
ALTER TABLE "shipping_option" DROP CONSTRAINT "shipping_method_carrierId_fkey";
DROP INDEX "shipping_method_carrierId_idx";
ALTER TABLE "shipping_option" DROP COLUMN "carrierId";

-- The supplies now sit on the service.
DROP TABLE "shipping_method_supply";

-- ── 4. The sale names the option ────────────────────────────────────────────────────────────────

ALTER TABLE "sale" RENAME COLUMN "shippingMethodId" TO "shippingOptionId";
ALTER TABLE "sale" RENAME COLUMN "shippingMethodName" TO "shippingOptionName";
ALTER TABLE "sale" RENAME CONSTRAINT "sale_shippingMethodId_fkey" TO "sale_shippingOptionId_fkey";
ALTER INDEX "sale_shippingMethodId_idx" RENAME TO "sale_shippingOptionId_idx";

-- Dropped by hand rather than `ON COMMIT DROP`: whether a migration runs in one transaction is the
-- runner's business, and the tables are needed across statements.
DROP TABLE "_service";
DROP TABLE "_method_key";
