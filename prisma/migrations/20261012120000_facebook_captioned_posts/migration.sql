-- A multi-lot Facebook post can carry each lot's text in its photo's caption (#1841; ADR-0061 §2 as
-- amended). Some groups want single series or single stamps offered together as one post of many
-- photos, each item's price and description in **its photo's caption** rather than in the post's
-- text. The model is unchanged — many offers, one lot each, posted together — so what is new is how
-- such a post is laid out, and the templates it is written from.
--
-- * On the Facebook defaults and on each group, four settings following #1661's rule (a group's own
--   only where `customSettings` names the key, blank otherwise):
--   - `multiLotLayout` — `text` (every lot in the post's text, what every post has been) or
--     `captions` (each lot one photo, its text in that photo's caption). Every existing row is `text`,
--     so nothing posts differently until the collector chooses.
--   - `auctionCaptionTemplate` / `quickBuyCaptionTemplate` — a lot's caption, per listing type.
--   - `captionPostTemplate` — the shared text of a captioned post.
--   Empty templates, as every new template here starts: a post is only what its template places
--   (#1692).
-- * On a multi-lot post, `layout` — the post's own choice, or NULL to follow its group's (live).

ALTER TABLE "facebook_defaults"
    ADD COLUMN "multiLotLayout" TEXT NOT NULL DEFAULT 'text',
    ADD COLUMN "auctionCaptionTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "quickBuyCaptionTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "captionPostTemplate" TEXT NOT NULL DEFAULT '';

ALTER TABLE "facebook_group"
    ADD COLUMN "multiLotLayout" TEXT NOT NULL DEFAULT 'text',
    ADD COLUMN "auctionCaptionTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "quickBuyCaptionTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "captionPostTemplate" TEXT NOT NULL DEFAULT '';

ALTER TABLE "facebook_post"
    ADD COLUMN "layout" TEXT,
    ADD CONSTRAINT "facebook_post_layout_known" CHECK ("layout" IS NULL OR "layout" IN ('text', 'captions'));
