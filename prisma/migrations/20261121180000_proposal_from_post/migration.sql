-- #2602: a Facebook post not yet up can be made into a proposal for one buyer.
--
-- The proposal names the post it was made from; its lots are the post's own offers, so whatever the
-- buyer takes is sold in the post. Null for a proposal of its own Direct lots, and again if the post
-- is deleted.
ALTER TABLE "proposal" ADD COLUMN "facebookPostId" TEXT;

CREATE INDEX "proposal_facebookPostId_idx" ON "proposal"("facebookPostId");

ALTER TABLE "proposal" ADD CONSTRAINT "proposal_facebookPostId_fkey"
    FOREIGN KEY ("facebookPostId") REFERENCES "facebook_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
