-- A Facebook offer can be a quick buy as well as an auction (#1671, amending ADR-0061).
--
-- Three settings join the Facebook defaults and a group's, each following the default-and-custom
-- rule of #1661: the listing type a new offer starts as, the quick-buy post template (beside the
-- auction one, which stays `postTemplate`), and whether the lots of one post may mix the two types.
-- Every Facebook offer so far was an auction, so the platform's listing type starts as `auction`
-- and every existing group follows it: nothing a collector creates changes until they say so.

ALTER TABLE "facebook_defaults"
    ADD COLUMN "listingType" TEXT NOT NULL DEFAULT 'auction',
    ADD COLUMN "quickBuyTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mixedListingTypes" BOOLEAN NOT NULL DEFAULT false;

-- A group's followed setting is stored blank, as its other ones are: the blank listing type is the
-- platform's own starting value, `auction`, and the blank mixing is `false`.
ALTER TABLE "facebook_group"
    ADD COLUMN "listingType" TEXT NOT NULL DEFAULT 'auction',
    ADD COLUMN "quickBuyTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "mixedListingTypes" BOOLEAN NOT NULL DEFAULT false;
