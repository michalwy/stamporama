-- A Facebook auction records its post in the offer's own listing link (#1668, amending #1544).
--
-- A post holding several lots kept its link in a column of its own, beside every lot's listing link,
-- and the collector saw two fields for one address. The listing link is now where the post is
-- recorded: activating a lot writes the post's link into every lot that has none of its own.
--
-- A recorded post link moves into each of its lots whose listing link is empty; a lot that already
-- has one — its own photo's link — keeps it. Then the post's column goes.
UPDATE "offer" AS o
SET "url" = p."url"
FROM "facebook_post" AS p
WHERE o."facebookPostId" = p."id"
  AND p."url" IS NOT NULL
  AND (o."url" IS NULL OR o."url" = '');

ALTER TABLE "facebook_post" DROP COLUMN "url";
