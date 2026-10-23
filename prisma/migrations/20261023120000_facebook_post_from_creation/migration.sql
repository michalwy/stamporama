-- A Facebook offer is in a post from the moment it is made (#2116, amending #1989, which made an offer
-- posted alone its post of one lot only when it was published). A post of one lot and a post of
-- several now differ only in their text templates.
--
-- 1. A post of one takes its offer's title and follows it while the offer's title changes, until the
--    post is renamed by hand or gains a second lot (`titleFollowsOffer`). An existing post of one
--    follows where nothing says its title was the collector's own: untitled, or titled exactly as its
--    offer is named now (#2068 copied the offer's title at publishing). One whose title differs was
--    typed in *Publish…* or renamed, and keeps it.
--
-- 2. Every Facebook offer still in no post — Preparing or Ready, since #1989's migration gave one to
--    everything past Ready — becomes lot 1 of a post of its own in its group, following its offer's
--    title. The title written here is the offer's stored title; an offer with none is titled at boot
--    with the label its sets give it (`syncFollowingPostTitles`), which only TypeScript builds.
--
-- The numbers come from each collection's counter, continuing after the posts it already has, in the
-- offers' creation order — never `max(...) + 1`, so a number is still never handed on (#1842).

ALTER TABLE "facebook_post" ADD COLUMN "titleFollowsOffer" BOOLEAN NOT NULL DEFAULT false;

UPDATE "facebook_post" p SET "titleFollowsOffer" = true
FROM "offer" o
WHERE o."facebookPostId" = p."id"
  AND (SELECT COUNT(*) FROM "offer" l WHERE l."facebookPostId" = p."id") = 1
  AND (p."title" IS NULL OR p."title" = btrim(o."name"));

CREATE TEMPORARY TABLE "_post_of_one" AS
SELECT
    gen_random_uuid()::text AS "postId",
    o."id" AS "offerId",
    o."collectionId",
    o."facebookGroupId" AS "groupId",
    NULLIF(btrim(o."name"), '') AS "title",
    c."nextFacebookPostNo" - 1 + ROW_NUMBER() OVER (
        PARTITION BY o."collectionId" ORDER BY o."createdAt" ASC, o."id" ASC
    ) AS "postNo"
FROM "offer" o
JOIN "collection" c ON c."id" = o."collectionId"
WHERE o."facebookGroupId" IS NOT NULL
  AND o."facebookPostId" IS NULL;

INSERT INTO "facebook_post" ("id", "collectionId", "groupId", "postNo", "title", "titleFollowsOffer")
SELECT "postId", "collectionId", "groupId", "postNo", "title", true FROM "_post_of_one";

UPDATE "offer" SET "facebookPostId" = p."postId", "facebookLotNo" = 1
FROM "_post_of_one" p
WHERE "offer"."id" = p."offerId";

UPDATE "collection" SET "nextFacebookPostNo" = sub.next
FROM (SELECT "collectionId", MAX("postNo") + 1 AS next FROM "_post_of_one" GROUP BY "collectionId") AS sub
WHERE "collection"."id" = sub."collectionId";

DROP TABLE "_post_of_one";
