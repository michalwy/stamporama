-- A buyer's link to a Facebook post's preview (#2212): `offer_specification_share_token`'s shape
-- (#1760) with the offer swapped for one post, and no contents hash — the link stays live.
CREATE TABLE "facebook_post_preview_token" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    -- Null once the post is gone; the address then says the offer is no longer current.
    "postId" TEXT,
    -- SHA-256 hex of the raw token (prefix "stmpf_"), the only form a lookup touches.
    "tokenHash" TEXT NOT NULL,
    -- The same token sealed (`secret-box.ts`), so the collector can be shown their own link again
    -- (#681). Null on an install with no key.
    "tokenSealed" TEXT,
    -- The post's language as last read, for the notice once the post is gone.
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "facebook_post_preview_token_pkey" PRIMARY KEY ("id")
);

-- One row per post: a new link replaces the row, which is what revocation means. Several rows may
-- have lost their post, which a unique index over nulls allows.
CREATE UNIQUE INDEX "facebook_post_preview_token_postId_key" ON "facebook_post_preview_token"("postId");
-- The lookup every served request makes.
CREATE UNIQUE INDEX "facebook_post_preview_token_tokenHash_key" ON "facebook_post_preview_token"("tokenHash");
CREATE INDEX "facebook_post_preview_token_collectionId_idx" ON "facebook_post_preview_token"("collectionId");

-- CASCADE: the link is the collection's and goes with it.
ALTER TABLE "facebook_post_preview_token" ADD CONSTRAINT "facebook_post_preview_token_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL: a deleted post leaves an address that says the offer is no longer current, rather than
-- one that reads as never having existed.
ALTER TABLE "facebook_post_preview_token" ADD CONSTRAINT "facebook_post_preview_token_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "facebook_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
