-- Facebook as a platform, with its groups (#1543; ADR-0061).
--
-- Facebook is one platform — one `contact`, named as Facebook through the same `platformModule`
-- marker Delcampe and Allegro use, so nothing here adds a column for that — and the groups the
-- collector auctions in sit under it. A group holds its customs: the post template, the standing
-- note on shipping, payment and terms, and the figures a new auction there starts from.
CREATE TABLE "facebook_group" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- Any http(s) address: the link is for opening the group, never for parsing.
    "url" TEXT NOT NULL,
    -- Archived groups are kept, listed apart and offered to no new auction.
    "archivedAt" TIMESTAMP(3),
    -- The text a post is prepared from, with `{token}` placeholders, and the note appended to it.
    "postTemplate" TEXT NOT NULL DEFAULT '',
    "standingNote" TEXT NOT NULL DEFAULT '',
    -- `amount` or `catalogPercent`; null is "no default", and the value is cleared with it.
    "startingPriceMode" TEXT,
    "startingPriceValue" DECIMAL(10,2),
    "bidIncrement" DECIMAL(10,2),
    "auctionDays" INTEGER,
    -- `HH:MM`, 24-hour.
    "closingTime" TEXT,
    -- Null is the platform's own currency.
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_group_pkey" PRIMARY KEY ("id")
);

-- The names are the pick list, so they are unique per platform — archived ones included, since an
-- archived group comes back under the name it had.
CREATE UNIQUE INDEX "facebook_group_platformId_name_key"
    ON "facebook_group"("platformId", "name");
CREATE INDEX "facebook_group_collectionId_idx" ON "facebook_group"("collectionId");
CREATE INDEX "facebook_group_platformId_idx" ON "facebook_group"("platformId");

ALTER TABLE "facebook_group" ADD CONSTRAINT "facebook_group_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A group belongs to its platform and goes with it. A platform with offers cannot be deleted in the
-- first place (`offer.platformId` restricts), so this never takes a group an offer names.
ALTER TABLE "facebook_group" ADD CONSTRAINT "facebook_group_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The group an offer is auctioned in. Null on every existing offer, and on every offer not on
-- Facebook. RESTRICT: a group with offers is archived, never deleted — it is where a sale happened.
ALTER TABLE "offer" ADD COLUMN "facebookGroupId" TEXT;

CREATE INDEX "offer_facebookGroupId_idx" ON "offer"("facebookGroupId");

ALTER TABLE "offer" ADD CONSTRAINT "offer_facebookGroupId_fkey"
    FOREIGN KEY ("facebookGroupId") REFERENCES "facebook_group"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
