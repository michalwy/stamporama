-- A listing may carry its own template, overriding the platform's (#774, falling out of #773).
--
-- The bulk-lot builder used to render its title and description once and freeze them with
-- `nameEdited` / `descriptionEdited`, because regenerating from the **platform's** template over a
-- hundred unrelated stamps emits a dozen catalogue ranges — past most platforms' limit, and an
-- over-long text blocks `preparing → ready` (#636). The cost was that the lot's wording then stopped
-- following the offer: strike a copy that sold elsewhere and the title still claimed a hundred.
--
-- With its own template on the offer, a lot commits with those flags **false** and follows its
-- composition the way every other listing does — safely, because a lot's template is short by
-- construction (`{count} stamps from {area}`) rather than an enumeration of what it lists.
--
-- Nullable with no default and no backfill: null is precisely what "use the platform's" already
-- meant, so every offer written before this keeps behaving exactly as it did.
--
-- No `privateNoteTemplate` companion — a lot has nothing to say in a seller-only note that the
-- platform's own template does not already say, and a column nothing writes is one to keep in step
-- for nothing.

ALTER TABLE "offer" ADD COLUMN "nameTemplate" TEXT;
ALTER TABLE "offer" ADD COLUMN "descriptionTemplate" TEXT;

-- And the same two on a lot preset (#773): how a kind of lot is *worded* repeats exactly as much as
-- how it is picked, so the recipe carries the wording. Null leaves the platform's own template.
ALTER TABLE "lot_builder_preset" ADD COLUMN "nameTemplate" TEXT;
ALTER TABLE "lot_builder_preset" ADD COLUMN "descriptionTemplate" TEXT;
