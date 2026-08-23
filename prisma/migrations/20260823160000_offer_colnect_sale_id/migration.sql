-- The Colnect listing this offer is up as (#696).
--
-- #412 stores the address Colnect landed on after a save (`https://colnect.com/en/market/sale/h5UXNh`)
-- and #462 reads the sale code back out of it to open the edit form. That is enough to *edit* a
-- listing and not enough to *find* one: Colnect states the same code at two addresses, the locale
-- segment of each is whatever Colnect served rather than what was asked for, and a code buried in a
-- string cannot be indexed or made unique. The transaction import (#698) does that lookup once per
-- imported row.
ALTER TABLE "offer" ADD COLUMN "colnectSaleId" TEXT;

-- Backfill out of the URLs already recorded.
--
-- The query + fragment are stripped **before** the code is read, so this reads the same string the
-- app's own `colnectSaleCode()` does — it parses `URL.pathname`, which has already dropped them —
-- and both addresses a code is stated at are accepted, since a URL pasted by hand off the seller's
-- own screen is the edit form's.
--
-- A code is written only where it is **unique within its collection**. A collision leaves both rows
-- null rather than picking one: the unique index below would refuse the migration otherwise, and a
-- silently chosen winner is worse than an unset column — those offers keep #462's URL fallback and
-- lose nothing they had.
WITH extracted AS (
    SELECT
        "id",
        "collectionId",
        COALESCE(
            substring(split_part(split_part("url", '#', 1), '?', 1) from '/market/sale/([^/]+)/?$'),
            substring(split_part(split_part("url", '#', 1), '?', 1) from '/sell/edit/sale_id/([^/]+)/?$')
        ) AS "code"
    FROM "offer"
    WHERE "url" IS NOT NULL
),
resolved AS (
    SELECT "id", "collectionId", "code"
    FROM extracted
    WHERE "code" IS NOT NULL AND "code" <> ''
),
unambiguous AS (
    SELECT "collectionId", "code"
    FROM resolved
    GROUP BY "collectionId", "code"
    HAVING count(*) = 1
)
UPDATE "offer" o
SET "colnectSaleId" = r."code"
FROM resolved r
JOIN unambiguous u ON u."collectionId" = r."collectionId" AND u."code" = r."code"
WHERE o."id" = r."id";

-- One live listing is one offer's, the guard `delcampeItemId` already carries (#611). It is what
-- makes "this offer is the one that transaction is about" an answer rather than a guess.
CREATE UNIQUE INDEX "offer_collectionId_colnectSaleId_key"
    ON "offer"("collectionId", "colnectSaleId");
