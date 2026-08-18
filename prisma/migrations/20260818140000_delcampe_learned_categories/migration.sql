-- Delcampe learned categories, from a platform-generic register (#609; ADR-0035).
--
-- Three changes, one decision. Delcampe's Easy Uploader row demands a `category_id`, and the answer
-- depends on the same four facts Allegro's does — the area, the year, the condition and the subtype —
-- so what the collection already learned about *one* marketplace's taxonomy is learned about the
-- other by the same mechanism rather than by a second copy of it.
--
--   1. `allegro_category_lesson` becomes `platform_category_lesson`. It was never Allegro-specific:
--      it has been keyed per (collection, platformId) since #488, and the Allegro name was the only
--      Allegro thing about it. `allegro_category_parameter_memory` is deliberately left alone —
--      Delcampe's categories carry no parameters, and that the two registers were separate tables
--      from the start is what makes only the shared half shared.
--   2. `offer` gains the Delcampe category the same way it holds the Allegro one (#494), minus the
--      parameters Delcampe does not have.
--   3. `delcampe_category` arrives as a dictionary of Delcampe's published category list, so an id
--      reaches the collector with a name and a breadcrumb instead of being typed from a spreadsheet.

-- ── 1. The register goes platform-generic ────────────────────────────────────────────────────────
-- A rename, not a copy: every row already names its platform, so nothing has to be moved, re-keyed
-- or backfilled, and Allegro keeps behaving exactly as it does today. The indexes and constraints
-- are renamed with it — Postgres keeps their old names through a table rename, and a
-- `platform_category_lesson` carrying five indexes called `allegro_…` is a table whose next reader
-- has to work out that it is not two tables.
ALTER TABLE "allegro_category_lesson" RENAME TO "platform_category_lesson";

ALTER TABLE "platform_category_lesson" RENAME CONSTRAINT "allegro_category_lesson_pkey" TO "platform_category_lesson_pkey";
ALTER TABLE "platform_category_lesson" RENAME CONSTRAINT "allegro_category_lesson_collectionId_fkey" TO "platform_category_lesson_collectionId_fkey";
ALTER TABLE "platform_category_lesson" RENAME CONSTRAINT "allegro_category_lesson_platformId_fkey" TO "platform_category_lesson_platformId_fkey";
ALTER TABLE "platform_category_lesson" RENAME CONSTRAINT "allegro_category_lesson_areaId_fkey" TO "platform_category_lesson_areaId_fkey";
ALTER TABLE "platform_category_lesson" RENAME CONSTRAINT "allegro_category_lesson_conditionId_fkey" TO "platform_category_lesson_conditionId_fkey";
ALTER TABLE "platform_category_lesson" RENAME CONSTRAINT "allegro_category_lesson_subtypeId_fkey" TO "platform_category_lesson_subtypeId_fkey";

-- The `NULLS NOT DISTINCT` key index (ADR-0006) travels under its new name unchanged. It is renamed
-- rather than dropped and recreated on purpose: dropping it, even for a statement, is dropping the
-- one guard that stops a mixed offer writing a second row instead of bumping the one it matched.
ALTER INDEX "allegro_category_lesson_key" RENAME TO "platform_category_lesson_key";
ALTER INDEX "allegro_category_lesson_collectionId_idx" RENAME TO "platform_category_lesson_collectionId_idx";
ALTER INDEX "allegro_category_lesson_platformId_idx" RENAME TO "platform_category_lesson_platformId_idx";
ALTER INDEX "allegro_category_lesson_areaId_idx" RENAME TO "platform_category_lesson_areaId_idx";
ALTER INDEX "allegro_category_lesson_conditionId_idx" RENAME TO "platform_category_lesson_conditionId_idx";
ALTER INDEX "allegro_category_lesson_subtypeId_idx" RENAME TO "platform_category_lesson_subtypeId_idx";

-- ── 2. The category one offer is uploaded in ─────────────────────────────────────────────────────
-- Beside the Allegro columns and shaped like them (#494): worked out when the offer gains its first
-- copy, correctable in place, and carrying its own provenance so a value nobody can account for
-- never appears on the card. `delcampeCategorySource` takes `learned` or `manual` and nothing else —
-- Delcampe has no title-guess of its own, so an unmatched key falls through to the picker, which is
-- a person rather than a third source.
ALTER TABLE "offer" ADD COLUMN "delcampeCategoryId" TEXT;
ALTER TABLE "offer" ADD COLUMN "delcampeCategoryName" TEXT;
ALTER TABLE "offer" ADD COLUMN "delcampeCategoryPath" TEXT;
ALTER TABLE "offer" ADD COLUMN "delcampeCategorySource" TEXT;
ALTER TABLE "offer" ADD COLUMN "delcampeCategoryMatchedOn" TEXT;

-- ── 3. Delcampe's own category list ──────────────────────────────────────────────────────────────
-- A dictionary of ids → names, not a mapping of stamps → categories: what a stamp should be listed
-- as is the register's answer and is learned, while `7945` on its own is simply unreadable.
--
-- **Instance-wide, with no `collectionId`** — the one table here that is not collection-scoped, and
-- deliberately: Delcampe's taxonomy is Delcampe's, identical for every collection on this instance,
-- and a per-collection copy would be N copies of one public fact refreshed N times. It holds nothing
-- of the collector's, so there is nothing to scope and nothing to authorize.
CREATE TABLE "delcampe_category" (
    -- Delcampe's own numeric id, as text: the CSV echoes it back verbatim and nothing does arithmetic
    -- on it.
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- The breadcrumb: `Stamps > Europe > Poland > 1919-1939 Second Republic > Used stamps`. The whole
    -- value of the picker — a leaf is called `Used stamps` some hundreds of times over on this tree,
    -- and only the path says which country's and which period's.
    "path" TEXT NOT NULL,
    -- When this row was last seen in Delcampe's published list. The refresh upserts what it read and
    -- deletes only what a **complete** pass did not see, so a crawl cut short by Delcampe's own rate
    -- limiting leaves the previous snapshot standing rather than emptying the picker.
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delcampe_category_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delcampe_category_refreshedAt_idx" ON "delcampe_category"("refreshedAt");
