-- Every Facebook offer that has gone up is in a post (#1989, amending ADR-0061 §2): an offer posted
-- alone is a post of one lot, so the list of posts shows everything that is up on Facebook. Until now
-- only a post of several lots had a row, and an offer posted alone carried its link and state on
-- itself.
--
-- Every Facebook offer in no post that has gone up — any state past Ready, `isFacebookLotPosted`'s
-- reading — becomes lot 1 of a post of its own in its group. Its link, state and frozen text stay on
-- the offer, where they already are for a lot of any post (#1668, #1800), so nothing else moves. An
-- offer still Preparing or Ready gets no post: from now on its post is made when it is published.
--
-- The numbers come from each collection's counter, continuing after the posts it already has, in
-- the offers' creation order — never `max(...) + 1`, so a number is still never handed on (#1842).
-- The posts get no title: a title is the collector's words (#1692), and an untitled post is flagged.

CREATE TEMPORARY TABLE "_one_lot_post" AS
SELECT
    gen_random_uuid()::text AS "postId",
    o."id" AS "offerId",
    o."collectionId",
    o."facebookGroupId" AS "groupId",
    c."nextFacebookPostNo" - 1 + ROW_NUMBER() OVER (
        PARTITION BY o."collectionId" ORDER BY o."createdAt" ASC, o."id" ASC
    ) AS "postNo"
FROM "offer" o
JOIN "collection" c ON c."id" = o."collectionId"
WHERE o."facebookGroupId" IS NOT NULL
  AND o."facebookPostId" IS NULL
  AND o."state" NOT IN ('preparing', 'ready');

INSERT INTO "facebook_post" ("id", "collectionId", "groupId", "postNo")
SELECT "postId", "collectionId", "groupId", "postNo" FROM "_one_lot_post";

UPDATE "offer" SET "facebookPostId" = p."postId", "facebookLotNo" = 1
FROM "_one_lot_post" p
WHERE "offer"."id" = p."offerId";

UPDATE "collection" SET "nextFacebookPostNo" = sub.next
FROM (SELECT "collectionId", MAX("postNo") + 1 AS next FROM "_one_lot_post" GROUP BY "collectionId") AS sub
WHERE "collection"."id" = sub."collectionId";

DROP TABLE "_one_lot_post";
