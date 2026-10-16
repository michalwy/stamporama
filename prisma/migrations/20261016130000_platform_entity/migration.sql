-- #1955 (ADR-0071): a marketplace stops being a `contact` with the Platform role and becomes a
-- `platform` of its own. The address book keeps only people and firms.
--
-- The move is done at once and keeps every id: each platform takes the id its contact had, so every
-- `platformId` in the database names the same thing before and after and only its foreign key is
-- pointed at the new table. Nothing is renumbered and no reference is rewritten.
--
--   1. the `platform` table;
--   2. every contact that was a platform becomes one — the contact chosen on the Allegro, Delcampe,
--      Facebook, Colnect or Philasearch page becomes that **module platform**, named after its
--      module; every other one a **generic platform** of its own name;
--   3. a collection that had no contact for a module gets that module platform, switched off;
--   4. every reference is pointed at `platform`;
--   5. the former platform contacts go, unless something keeps them in the address book;
--   6. the contact loses the Platform role and every column only a platform carried.

-- ── 1. The table ─────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "platform" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "platformModule" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "market" TEXT,
    "platformCurrency" TEXT,
    "titleTemplate" TEXT,
    "descriptionTemplate" TEXT,
    "privateNoteTemplate" TEXT,
    "buyerMessageTemplate" TEXT,
    "descriptionFormat" TEXT NOT NULL DEFAULT 'plain',
    "titleLanguage" TEXT,
    "defaultStartingPrice" DECIMAL(10,2),
    "minimumPrice" DECIMAL(10,2),
    "defaultListingType" TEXT,
    "maxPhotos" INTEGER,
    "maxPhotoEdge" INTEGER,
    "maxPhotoFileSizeMib" INTEGER,
    "maxTitleLength" INTEGER,
    "maxDescriptionLength" INTEGER,
    "maxPrivateNoteLength" INTEGER,
    "photoSides" TEXT NOT NULL DEFAULT 'front',
    "photoPreferSingles" BOOLEAN NOT NULL DEFAULT true,
    "coverSymbols" BOOLEAN NOT NULL DEFAULT false,
    "coverStyle" TEXT NOT NULL DEFAULT 'pixelate',
    "coverColor" TEXT NOT NULL DEFAULT '#000000',
    "tileLabelLeftTemplate" TEXT,
    "tileLabelRightTemplate" TEXT,
    "defaultCollageTemplateId" TEXT,
    "photoGroupByChecklist" BOOLEAN NOT NULL DEFAULT false,
    "defaultGroupCollageTemplateId" TEXT,
    "defaultAllegroListingProfileId" TEXT,
    "defaultDelcampeListingProfileId" TEXT,
    "refreshQuickBuysAfterDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_pkey" PRIMARY KEY ("id")
);

-- ── 2. Every platform contact becomes a platform ─────────────────────────────────────────────────

-- The fixed names of the five module platforms.
CREATE TEMP TABLE "_module" ("module" TEXT PRIMARY KEY, "name" TEXT NOT NULL);
INSERT INTO "_module" VALUES
    ('allegro', 'Allegro'),
    ('delcampe', 'Delcampe'),
    ('facebook', 'Facebook'),
    ('colnect', 'Colnect'),
    ('philasearch', 'Philasearch');

-- Which contacts are platforms. The role alone would miss one whose role was unticked after records
-- had named it — every reference below must find its platform — so a contact counts when it carries
-- the role, holds a module marker, or is named as a platform by anything.
CREATE TEMP TABLE "_platform_contact" AS
SELECT c."id"
FROM "contact" c
WHERE c."platform"
   OR c."platformModule" IN (SELECT "module" FROM "_module")
   OR EXISTS (SELECT 1 FROM "offer" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "sale" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "purchase" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "auction_sale" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "price_observation" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "shipping_option" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "allegro_listing_profile" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "delcampe_listing_profile" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "facebook_group" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "facebook_defaults" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "platform_category_lesson" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "allegro_category_parameter_memory" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "item_platform_exclusion" x WHERE x."platformId" = c."id")
   OR EXISTS (SELECT 1 FROM "contact" s WHERE s."defaultAuctionPlatformId" = c."id");

-- The module each contact becomes. The page setter kept a marker exclusive, but nothing in the
-- database did, so should two contacts of one collection carry the same one, the first by name keeps
-- it and the other becomes generic.
CREATE TEMP TABLE "_platform_module" AS
SELECT c."id",
       CASE WHEN row_number() OVER (PARTITION BY c."collectionId", c."platformModule" ORDER BY c."name", c."id") = 1
            THEN m."module" END AS "module"
FROM "contact" c
JOIN "_platform_contact" pc ON pc."id" = c."id"
LEFT JOIN "_module" m ON m."module" = c."platformModule";

-- A module platform takes its module's name. A generic one keeps its own — unless that is a module's
-- name, which every collection now holds: it then gains a suffix, and stays renamable.
-- `enabled` follows the role: a contact still carrying it was offered in the pickers, and one whose
-- role had been unticked was not.
INSERT INTO "platform" (
    "id", "collectionId", "name", "notes", "platformModule", "enabled", "market",
    "platformCurrency", "titleTemplate", "descriptionTemplate", "privateNoteTemplate",
    "buyerMessageTemplate", "descriptionFormat", "titleLanguage", "defaultStartingPrice",
    "minimumPrice", "defaultListingType", "maxPhotos", "maxPhotoEdge", "maxPhotoFileSizeMib",
    "maxTitleLength", "maxDescriptionLength", "maxPrivateNoteLength", "photoSides",
    "photoPreferSingles", "coverSymbols", "coverStyle", "coverColor", "tileLabelLeftTemplate",
    "tileLabelRightTemplate", "defaultCollageTemplateId", "photoGroupByChecklist",
    "defaultGroupCollageTemplateId", "defaultAllegroListingProfileId",
    "defaultDelcampeListingProfileId", "refreshQuickBuysAfterDays", "createdAt"
)
SELECT
    c."id", c."collectionId",
    CASE
        WHEN pm."module" IS NOT NULL THEN (SELECT m."name" FROM "_module" m WHERE m."module" = pm."module")
        WHEN lower(c."name") IN (SELECT lower(m."name") FROM "_module" m) THEN c."name" || ' (2)'
        ELSE c."name"
    END,
    c."notes", pm."module", c."platform", c."market",
    c."platformCurrency", c."titleTemplate", c."descriptionTemplate", c."privateNoteTemplate",
    c."buyerMessageTemplate", c."descriptionFormat", c."titleLanguage", c."defaultStartingPrice",
    c."minimumPrice", c."defaultListingType", c."maxPhotos", c."maxPhotoEdge", c."maxPhotoFileSizeMib",
    c."maxTitleLength", c."maxDescriptionLength", c."maxPrivateNoteLength", c."photoSides",
    c."photoPreferSingles", c."coverSymbols", c."coverStyle", c."coverColor", c."tileLabelLeftTemplate",
    c."tileLabelRightTemplate", c."defaultCollageTemplateId", c."photoGroupByChecklist",
    c."defaultGroupCollageTemplateId", c."defaultAllegroListingProfileId",
    c."defaultDelcampeListingProfileId", c."refreshQuickBuysAfterDays", c."createdAt"
FROM "contact" c
JOIN "_platform_module" pm ON pm."id" = c."id";

-- ── 3. The module platforms no contact stood for ────────────────────────────────────────────────

-- Exactly one of each per collection, switched off until the collector turns it on on its page.
INSERT INTO "platform" ("id", "collectionId", "name", "platformModule", "enabled")
SELECT gen_random_uuid()::text, col."id", m."name", m."module", false
FROM "collection" col
CROSS JOIN "_module" m
WHERE NOT EXISTS (
    SELECT 1 FROM "platform" p WHERE p."collectionId" = col."id" AND p."platformModule" = m."module"
);

-- ── 4. Every reference points at the platform ───────────────────────────────────────────────────

ALTER TABLE "offer" DROP CONSTRAINT "offer_platformId_fkey";
ALTER TABLE "offer" ADD CONSTRAINT "offer_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sale" DROP CONSTRAINT "sale_platformId_fkey";
ALTER TABLE "sale" ADD CONSTRAINT "sale_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase" DROP CONSTRAINT "purchase_platformId_fkey";
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auction_sale" DROP CONSTRAINT "auction_sale_platformId_fkey";
ALTER TABLE "auction_sale" ADD CONSTRAINT "auction_sale_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "price_observation" DROP CONSTRAINT "price_observation_platformId_fkey";
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shipping_option" DROP CONSTRAINT "shipping_option_platformId_fkey";
ALTER TABLE "shipping_option" ADD CONSTRAINT "shipping_option_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "allegro_listing_profile" DROP CONSTRAINT "allegro_listing_profile_platformId_fkey";
ALTER TABLE "allegro_listing_profile" ADD CONSTRAINT "allegro_listing_profile_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delcampe_listing_profile" DROP CONSTRAINT "delcampe_listing_profile_platformId_fkey";
ALTER TABLE "delcampe_listing_profile" ADD CONSTRAINT "delcampe_listing_profile_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "facebook_group" DROP CONSTRAINT "facebook_group_platformId_fkey";
ALTER TABLE "facebook_group" ADD CONSTRAINT "facebook_group_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "facebook_defaults" DROP CONSTRAINT "facebook_defaults_platformId_fkey";
ALTER TABLE "facebook_defaults" ADD CONSTRAINT "facebook_defaults_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_category_lesson" DROP CONSTRAINT "platform_category_lesson_platformId_fkey";
ALTER TABLE "platform_category_lesson" ADD CONSTRAINT "platform_category_lesson_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "allegro_category_parameter_memory" DROP CONSTRAINT "allegro_category_parameter_memory_platformId_fkey";
ALTER TABLE "allegro_category_parameter_memory" ADD CONSTRAINT "allegro_category_parameter_memory_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_platform_exclusion" DROP CONSTRAINT "item_platform_exclusion_platformId_fkey";
ALTER TABLE "item_platform_exclusion" ADD CONSTRAINT "item_platform_exclusion_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact" DROP CONSTRAINT "contact_defaultAuctionPlatformId_fkey";
ALTER TABLE "contact" ADD CONSTRAINT "contact_defaultAuctionPlatformId_fkey"
    FOREIGN KEY ("defaultAuctionPlatformId") REFERENCES "platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The platform's own references, which were the contact's.
ALTER TABLE "platform" ADD CONSTRAINT "platform_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform" ADD CONSTRAINT "platform_defaultCollageTemplateId_fkey"
    FOREIGN KEY ("defaultCollageTemplateId") REFERENCES "collage_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform" ADD CONSTRAINT "platform_defaultGroupCollageTemplateId_fkey"
    FOREIGN KEY ("defaultGroupCollageTemplateId") REFERENCES "collage_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform" ADD CONSTRAINT "platform_defaultAllegroListingProfileId_fkey"
    FOREIGN KEY ("defaultAllegroListingProfileId") REFERENCES "allegro_listing_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform" ADD CONSTRAINT "platform_defaultDelcampeListingProfileId_fkey"
    FOREIGN KEY ("defaultDelcampeListingProfileId") REFERENCES "delcampe_listing_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "platform_collectionId_name_key" ON "platform"("collectionId", "name");
CREATE UNIQUE INDEX "platform_collectionId_platformModule_key" ON "platform"("collectionId", "platformModule");
CREATE INDEX "platform_collectionId_idx" ON "platform"("collectionId");
CREATE INDEX "platform_defaultCollageTemplateId_idx" ON "platform"("defaultCollageTemplateId");
CREATE INDEX "platform_defaultGroupCollageTemplateId_idx" ON "platform"("defaultGroupCollageTemplateId");
CREATE INDEX "platform_defaultAllegroListingProfileId_idx" ON "platform"("defaultAllegroListingProfileId");
CREATE INDEX "platform_defaultDelcampeListingProfileId_idx" ON "platform"("defaultDelcampeListingProfileId");

-- ── 5. The former platform contacts go, unless something keeps them ─────────────────────────────

-- A former platform contact stays in the address book — as an ordinary contact — when it carries
-- another role, is the counterparty on some record, or has an address-book field filled. Its notes
-- were copied onto the platform above and are left on a contact that stays.
DELETE FROM "contact" c
USING "_platform_contact" pc
WHERE pc."id" = c."id"
  AND NOT (c."buyer" OR c."seller" OR c."exchangePartner" OR c."auctionHouse" OR c."other")
  AND NULLIF(btrim(c."fullName"), '') IS NULL
  AND NULLIF(btrim(c."email"), '') IS NULL
  AND NULLIF(btrim(c."phone"), '') IS NULL
  AND NULLIF(btrim(c."facebookProfileUrl"), '') IS NULL
  AND NOT EXISTS (SELECT 1 FROM "purchase" x WHERE x."contactId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "sale" x WHERE x."buyerId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "auction_sale" x WHERE x."sellerId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "price_observation" x WHERE x."auctionHouseId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "trade" x WHERE x."partnerId" = c."id");

-- ── 6. The contact loses the role and what only a platform carried ───────────────────────────────

ALTER TABLE "contact" DROP CONSTRAINT "contact_defaultAllegroListingProfileId_fkey";
ALTER TABLE "contact" DROP CONSTRAINT "contact_defaultCollageTemplateId_fkey";
ALTER TABLE "contact" DROP CONSTRAINT "contact_defaultDelcampeListingProfileId_fkey";
ALTER TABLE "contact" DROP CONSTRAINT "contact_defaultGroupCollageTemplateId_fkey";

DROP INDEX "contact_defaultAllegroListingProfileId_idx";
DROP INDEX "contact_defaultCollageTemplateId_idx";
DROP INDEX "contact_defaultDelcampeListingProfileId_idx";
DROP INDEX "contact_defaultGroupCollageTemplateId_idx";

ALTER TABLE "contact"
    DROP COLUMN "platform",
    DROP COLUMN "platformModule",
    DROP COLUMN "platformCurrency",
    DROP COLUMN "titleTemplate",
    DROP COLUMN "descriptionTemplate",
    DROP COLUMN "privateNoteTemplate",
    DROP COLUMN "buyerMessageTemplate",
    DROP COLUMN "descriptionFormat",
    DROP COLUMN "titleLanguage",
    DROP COLUMN "defaultStartingPrice",
    DROP COLUMN "minimumPrice",
    DROP COLUMN "defaultListingType",
    DROP COLUMN "maxPhotos",
    DROP COLUMN "maxPhotoEdge",
    DROP COLUMN "maxPhotoFileSizeMib",
    DROP COLUMN "maxTitleLength",
    DROP COLUMN "maxDescriptionLength",
    DROP COLUMN "maxPrivateNoteLength",
    DROP COLUMN "photoSides",
    DROP COLUMN "photoPreferSingles",
    DROP COLUMN "coverSymbols",
    DROP COLUMN "coverStyle",
    DROP COLUMN "coverColor",
    DROP COLUMN "tileLabelLeftTemplate",
    DROP COLUMN "tileLabelRightTemplate",
    DROP COLUMN "defaultCollageTemplateId",
    DROP COLUMN "photoGroupByChecklist",
    DROP COLUMN "defaultGroupCollageTemplateId",
    DROP COLUMN "defaultAllegroListingProfileId",
    DROP COLUMN "defaultDelcampeListingProfileId",
    DROP COLUMN "refreshQuickBuysAfterDays";

DROP TABLE "_platform_module";
DROP TABLE "_platform_contact";
DROP TABLE "_module";
