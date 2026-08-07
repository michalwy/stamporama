-- Copies deliberately never listed on one platform (#506).
--
-- The *not offered on X* worklist (#259) surfaces every for-sale copy with no live offer there, and
-- a copy the collector has decided never to list keeps answering that question for ever — a backlog
-- of them buries the copy that genuinely needs a listing. This table is the decision itself: one row
-- per (copy, platform), its presence being the whole state.
--
-- No reason column, on purpose: the worklist only needs the question settled, and the copy's own
-- `notes` are where anything about *why* belongs.
--
-- Both FKs CASCADE rather than RESTRICT, unlike every reference that records something that
-- happened: deleting a copy takes its exclusions with it, and deleting a platform contact must not
-- be blocked by a preference that stops meaning anything once the platform is gone.
CREATE TABLE "item_platform_exclusion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_platform_exclusion_pkey" PRIMARY KEY ("id")
);

-- One decision per copy per platform — what makes setting the flag twice a no-op.
CREATE UNIQUE INDEX "item_platform_exclusion_itemId_platformId_key"
    ON "item_platform_exclusion"("itemId", "platformId");

-- The review read ("everything excluded from this platform") narrows by platform alone.
CREATE INDEX "item_platform_exclusion_platformId_idx" ON "item_platform_exclusion"("platformId");

ALTER TABLE "item_platform_exclusion" ADD CONSTRAINT "item_platform_exclusion_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_platform_exclusion" ADD CONSTRAINT "item_platform_exclusion_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
