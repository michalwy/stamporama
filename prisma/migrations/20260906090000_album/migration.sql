-- The album, its entries and its per-album stamp order (#767). The design is #755; ADR-0045 states
-- the model.
--
-- An album is a **durable, printed object** — pages get glued into — so the schema is arranged
-- around the two things paper cannot take back: a page's identity must not move when the collection
-- grows, and a hawid cut to the wrong size is gone.
--
-- Three tables and no fourth. There is deliberately **no page table here**: a live page is a plan,
-- re-derived from current data whenever anything it reads changes, and only a page the collector
-- marks *printed* becomes a stored result — which is #778's, along with the divergence report and
-- the continuation/reprint choice. Storing the live plan would make it a cache that can go quietly
-- stale, which is the failure #755 rejected a `frozen` boolean for.

-- The album itself. The 40 render columns are `album_template`'s, **copied** — #308's rule, and it
-- matters more here than anywhere: editing a template must not reach back into a page already
-- sitting in a binder. There is therefore no `albumTemplateId`, and this duplication is the design
-- rather than a normalisation waiting to be tidied away. `AlbumRenderPreset` in
-- `src/lib/album-template-rules.ts` is what keeps the two lists in step, and it stays a shared
-- *type*.
CREATE TABLE "album" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    -- The area whose subtree supplies the entries.
    "collectionAreaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- The album is printed in one language and it is the album's own (#755): headings are longer in
    -- some languages, longer headings wrap, and wrapping changes where a block stops fitting — so
    -- the page plan depends on this column. Not nullable; a new album starts at the collection's
    -- own default language. #777 unions these into the collection's language set.
    "language" TEXT NOT NULL,

    -- Page
    "pageWidthMm" DOUBLE PRECISION NOT NULL,
    "pageHeightMm" DOUBLE PRECISION NOT NULL,
    "marginTopMm" DOUBLE PRECISION NOT NULL,
    "marginRightMm" DOUBLE PRECISION NOT NULL,
    "marginBottomMm" DOUBLE PRECISION NOT NULL,
    "marginLeftMm" DOUBLE PRECISION NOT NULL,
    "columns" INTEGER NOT NULL DEFAULT 1,
    "columnGapMm" DOUBLE PRECISION NOT NULL,
    "borderStyle" TEXT NOT NULL DEFAULT 'none',
    "borderWidthMm" DOUBLE PRECISION NOT NULL,
    "borderInsetMm" DOUBLE PRECISION NOT NULL,

    -- Spacing
    "boxGapXMm" DOUBLE PRECISION NOT NULL,
    "boxGapYMm" DOUBLE PRECISION NOT NULL,
    "headingSpaceAboveMm" DOUBLE PRECISION NOT NULL,
    "headingSpaceBelowMm" DOUBLE PRECISION NOT NULL,

    -- Hawid clearances (#765)
    "verticalClearanceMm" DOUBLE PRECISION NOT NULL,
    "horizontalMarginMm" DOUBLE PRECISION NOT NULL,

    -- Type: a face id from the shipped set, and a size in points, per role
    "titleFace" TEXT NOT NULL,
    "titleSizePt" DOUBLE PRECISION NOT NULL,
    "chapterFace" TEXT NOT NULL,
    "chapterSizePt" DOUBLE PRECISION NOT NULL,
    "headingFace" TEXT NOT NULL,
    "headingSizePt" DOUBLE PRECISION NOT NULL,
    "labelFace" TEXT NOT NULL,
    "labelSizePt" DOUBLE PRECISION NOT NULL,
    "footerFace" TEXT NOT NULL,
    "footerSizePt" DOUBLE PRECISION NOT NULL,

    -- Boxes
    "boxBorderStyle" TEXT NOT NULL DEFAULT 'solid',
    "boxBorderWidthMm" DOUBLE PRECISION NOT NULL,
    "labelPosition" TEXT NOT NULL DEFAULT 'below',

    -- Photos
    "printPhotos" BOOLEAN NOT NULL DEFAULT false,
    "photoOpacityPercent" INTEGER NOT NULL DEFAULT 100,

    -- Texts, as {token} templates over the shared vocabulary
    "chapterTemplate" TEXT NOT NULL DEFAULT '',
    "checklistTemplate" TEXT NOT NULL DEFAULT '',
    "boxLabelTemplate" TEXT NOT NULL DEFAULT '',
    "footerTemplate" TEXT NOT NULL DEFAULT '',

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "album_pkey" PRIMARY KEY ("id")
);

-- One checklist in one album (#531, ADR-0031). A checklist rather than an issue, because a checklist
-- is what counts as one complete unit and that is what a card is laid out for.
CREATE TABLE "album_entry" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    -- Seeded in catalog order, then the collector's; densely renumbered on a reorder, exactly as
    -- `checklist_stamp.sortOrder` (#764) is one level down.
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "album_entry_pkey" PRIMARY KEY ("id")
);

-- This album's own order for the stamps of one entry, overriding #764's collection-wide order.
-- Written for every stamp of the entry or for none: a sparse override cannot define an order, so
-- the presence of rows is itself the "this album differs" flag the page editor (#769) reads.
CREATE TABLE "album_entry_stamp_order" (
    "albumEntryId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "album_entry_stamp_order_pkey" PRIMARY KEY ("albumEntryId", "stampId")
);

-- An album is picked and printed by name, and two called "Polska" would make which binder a footer
-- names depend on which row came back first (`album_template`'s rule, #569).
CREATE UNIQUE INDEX "album_collectionId_name_key" ON "album"("collectionId", "name");
CREATE INDEX "album_collectionId_idx" ON "album"("collectionId");
CREATE INDEX "album_collectionAreaId_idx" ON "album"("collectionAreaId");

-- One entry per checklist: the same checklist printed twice in one album is two cards each claiming
-- to be the same complete unit.
CREATE UNIQUE INDEX "album_entry_albumId_checklistId_key" ON "album_entry"("albumId", "checklistId");
CREATE INDEX "album_entry_albumId_sortOrder_idx" ON "album_entry"("albumId", "sortOrder");
CREATE INDEX "album_entry_checklistId_idx" ON "album_entry"("checklistId");

CREATE INDEX "album_entry_stamp_order_albumEntryId_sortOrder_idx" ON "album_entry_stamp_order"("albumEntryId", "sortOrder");
CREATE INDEX "album_entry_stamp_order_stampId_idx" ON "album_entry_stamp_order"("stampId");

ALTER TABLE "album" ADD CONSTRAINT "album_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Cascade from the area: an album is *about* an area, and an area that is gone leaves an album with
-- nothing to gather entries from. Deleting an area is already the deliberate act that takes its
-- issues with it.
ALTER TABLE "album" ADD CONSTRAINT "album_collectionAreaId_fkey" FOREIGN KEY ("collectionAreaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "album_entry" ADD CONSTRAINT "album_entry_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A deleted checklist takes its entry with it: the entry is a pointer at a collecting goal, and a
-- goal that no longer exists has no card to lay out.
ALTER TABLE "album_entry" ADD CONSTRAINT "album_entry_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "album_entry_stamp_order" ADD CONSTRAINT "album_entry_stamp_order_albumEntryId_fkey" FOREIGN KEY ("albumEntryId") REFERENCES "album_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_entry_stamp_order" ADD CONSTRAINT "album_entry_stamp_order_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
