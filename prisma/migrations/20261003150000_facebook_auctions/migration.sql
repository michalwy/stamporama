-- A Facebook auction offer, alone or as a lot of a multi-lot post (#1544; ADR-0061 §2, §3, §5).
--
-- An offer on Facebook is an auction in one group (`offer.facebookGroupId`, #1543). What it adds is
-- its own bid increment, read from the group when the offer is created and then the offer's, and —
-- when several offers go up together as one post — the post they share and their lot numbers in it.
-- An offer posted alone has no post row: its own `url` is the post's link.

-- How much a bid must beat the last one by. Null on every offer not on Facebook, and on one whose
-- group states no increment.
ALTER TABLE "offer" ADD COLUMN "bidIncrement" DECIMAL(10,2);

-- A post holding several lots: an album in one group, each photo a lot bid on in its own comments.
-- The lots share the group and the closing time; the closing time is kept on each offer (`endsAt`),
-- where everything that reads an auction's end already looks, and written to all of them together.
CREATE TABLE "facebook_post" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    -- The post's own link, pasted once it is up. Null until then; recording it activates the lots.
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_post_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "facebook_post_collectionId_idx" ON "facebook_post"("collectionId");
CREATE INDEX "facebook_post_groupId_idx" ON "facebook_post"("groupId");

ALTER TABLE "facebook_post" ADD CONSTRAINT "facebook_post_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, for the offers' own reason (#1543): a group with posts is where sales happened.
ALTER TABLE "facebook_post" ADD CONSTRAINT "facebook_post_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "facebook_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The post an offer is a lot of, and its number there (`Lot 3`). Both null on an offer posted alone.
ALTER TABLE "offer" ADD COLUMN "facebookPostId" TEXT;
ALTER TABLE "offer" ADD COLUMN "facebookLotNo" INTEGER;

CREATE INDEX "offer_facebookPostId_idx" ON "offer"("facebookPostId");
-- One lot number per post. Postgres treats nulls as distinct, so offers outside a post never collide.
CREATE UNIQUE INDEX "offer_facebookPostId_facebookLotNo_key" ON "offer"("facebookPostId", "facebookLotNo");

-- SET NULL: deleting a lot's offer must not take the post with it, and a post is only ever removed
-- by the app, which renumbers or dissolves it first.
ALTER TABLE "offer" ADD CONSTRAINT "offer_facebookPostId_fkey"
    FOREIGN KEY ("facebookPostId") REFERENCES "facebook_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
