-- The message to a buyer after a sale (#1815): what to pay, where, and what happens next, generated
-- from a template per platform.
--
-- * On a platform contact, `buyerMessageTemplate` — null on every one: no platform had a message, so
--   no sale offers one until the collector writes it.
-- * On Facebook, where a platform's settings live in `facebook_defaults` since #1661, the template is
--   there and on each group, which follows the defaults unless it lists the key in `customSettings`.
--   Empty, the blank the other Facebook templates use; no group lists the key, so all follow.

ALTER TABLE "contact"
    ADD COLUMN "buyerMessageTemplate" TEXT;

ALTER TABLE "facebook_defaults"
    ADD COLUMN "buyerMessageTemplate" TEXT NOT NULL DEFAULT '';

ALTER TABLE "facebook_group"
    ADD COLUMN "buyerMessageTemplate" TEXT NOT NULL DEFAULT '';
