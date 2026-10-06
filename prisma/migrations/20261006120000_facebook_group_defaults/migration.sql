-- A Facebook group's posting settings follow the platform's unless set custom (#1661, amending
-- ADR-0061 §6).
--
-- The platform's own settings are a row per platform contact; a group lists which of its settings
-- are its own (`customSettings`) and follows the platform for the rest. Nothing a group posts
-- changes here: a setting equal to the platform's becomes *follows*, one that differs stays custom.

CREATE TABLE "facebook_defaults" (
    "platformId" TEXT NOT NULL,
    "postTemplate" TEXT NOT NULL DEFAULT '',
    "standingNote" TEXT NOT NULL DEFAULT '',
    -- `amount` or `catalogPercent`; null is "no default", and the value is cleared with it.
    "startingPriceMode" TEXT,
    "startingPriceValue" DECIMAL(10,2),
    "bidIncrement" DECIMAL(10,2),
    "auctionDays" INTEGER,
    -- `HH:MM`, 24-hour.
    "closingTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_defaults_pkey" PRIMARY KEY ("platformId")
);

ALTER TABLE "facebook_defaults" ADD CONSTRAINT "facebook_defaults_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The Facebook platform's default starting price moves here (decided with the collector on
-- 2026-10-06). On the contact it was an amount, read by no Facebook auction — a group's figure stood
-- in for it (#1544) — and kept only while the contact's default listing type was `auction`; here it
-- is a group's kind of figure, an amount or a share of catalogue value, and the contact's own field
-- is no longer offered for the Facebook platform. So it is carried over as an `amount` and cleared
-- on the contact, leaving one place it is stated.
INSERT INTO "facebook_defaults" ("platformId", "startingPriceMode", "startingPriceValue")
SELECT "id", 'amount', "defaultStartingPrice"
FROM "contact"
WHERE "platformModule" = 'facebook' AND "defaultStartingPrice" IS NOT NULL;

UPDATE "contact" SET "defaultStartingPrice" = NULL
WHERE "platformModule" = 'facebook' AND "defaultStartingPrice" IS NOT NULL;

ALTER TABLE "facebook_group" ADD COLUMN "customSettings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Each existing group: a setting is custom where its value differs from its platform's, which is
-- blank where the platform has no row. The currency follows where the group named none (that already
-- meant the platform's) or named the platform's own.
UPDATE "facebook_group" g
SET "customSettings" = ARRAY_REMOVE(ARRAY[
    CASE WHEN g."postTemplate" <> COALESCE(d."postTemplate", '') THEN 'postTemplate' END,
    CASE WHEN g."standingNote" <> COALESCE(d."standingNote", '') THEN 'standingNote' END,
    CASE WHEN g."startingPriceMode" IS DISTINCT FROM d."startingPriceMode"
           OR g."startingPriceValue" IS DISTINCT FROM d."startingPriceValue" THEN 'startingPrice' END,
    CASE WHEN g."bidIncrement" IS DISTINCT FROM d."bidIncrement" THEN 'bidIncrement' END,
    CASE WHEN g."auctionDays" IS DISTINCT FROM d."auctionDays" THEN 'auctionDays' END,
    CASE WHEN g."closingTime" IS DISTINCT FROM d."closingTime" THEN 'closingTime' END,
    CASE WHEN g."currency" IS NOT NULL AND g."currency" IS DISTINCT FROM c."platformCurrency"
         THEN 'currency' END
  ]::TEXT[], NULL)
FROM "contact" c
LEFT JOIN "facebook_defaults" d ON d."platformId" = c."id"
WHERE c."id" = g."platformId";

-- A setting that follows the platform keeps no value of its own.
UPDATE "facebook_group" SET
    "postTemplate" = CASE WHEN 'postTemplate' = ANY("customSettings") THEN "postTemplate" ELSE '' END,
    "standingNote" = CASE WHEN 'standingNote' = ANY("customSettings") THEN "standingNote" ELSE '' END,
    "startingPriceMode" =
      CASE WHEN 'startingPrice' = ANY("customSettings") THEN "startingPriceMode" END,
    "startingPriceValue" =
      CASE WHEN 'startingPrice' = ANY("customSettings") THEN "startingPriceValue" END,
    "bidIncrement" = CASE WHEN 'bidIncrement' = ANY("customSettings") THEN "bidIncrement" END,
    "auctionDays" = CASE WHEN 'auctionDays' = ANY("customSettings") THEN "auctionDays" END,
    "closingTime" = CASE WHEN 'closingTime' = ANY("customSettings") THEN "closingTime" END,
    "currency" = CASE WHEN 'currency' = ANY("customSettings") THEN "currency" END;
