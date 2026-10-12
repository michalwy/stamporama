-- Every multi-lot Facebook post has a title (#1862, decided with the collector on 2026-10-12), so that
-- with several posts running at once each can be told apart by more than its number. *Post together*
-- asks for it and the post's screen edits it; it is what `{postTitle}` puts into a captioned post's
-- text and its captions.
--
-- Nullable: posts made before this have none until one is given, and are named by number meanwhile.
-- Nothing is backfilled — a title is the collector's words, never made up for them (#1692).

ALTER TABLE "facebook_post" ADD COLUMN "title" TEXT;
