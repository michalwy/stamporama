-- How many lots one Facebook post may hold (#2480).
--
-- Facebook groups often accept only a few dozen lots per post. `maxLotsPerPost` is a followed group
-- setting under #1661's rule: on `facebook_defaults` for the platform, and on each group, which follows
-- the defaults unless it lists the key in `customSettings`. Generate offers' *In a new post* reads it
-- to split its new offers into as many posts as the limit needs. Null everywhere — no limit, one post,
-- which is what every pass made until now.

ALTER TABLE "facebook_defaults"
    ADD COLUMN "maxLotsPerPost" INTEGER;

ALTER TABLE "facebook_group"
    ADD COLUMN "maxLotsPerPost" INTEGER;
