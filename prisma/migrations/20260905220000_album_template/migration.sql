-- The collection's album templates (#766) — how an album page looks, held once and reused.
--
-- A render preset, the direct analogue of `collage_template` (#307): page geometry, spacing, the
-- hawid clearances the box rule (#765) adds to a stamp, a face and size per type role, the box
-- outline, the photo treatment, and the four texts as `{token}` templates.
--
-- **Seeded, never referenced** (#308). Choosing a template on an album copies these values onto the
-- album (#767); no album will carry an `albumTemplateId` and nothing here is read at plan time.
-- That is why the same columns are about to be duplicated onto `album` rather than joined to: an
-- album is printed on paper and glued into, so editing a template must not reach back into a page
-- already in a binder.
--
-- Two units on purpose: geometry in millimetres (they get cut), type sizes in points (the unit the
-- collector's AlbumEasy sources state type in, and the unit a PDF is drawn in).
--
-- Nothing is seeded and nothing is backfilled. A collection with no template has none, and #767's
-- album form says so rather than inventing a page size nobody chose.

CREATE TABLE "album_template" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

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

    CONSTRAINT "album_template_pkey" PRIMARY KEY ("id")
);

-- Picked by name on an album, so two of one name would make which you seeded from depend on row
-- order (`ref_card_template`'s rule, #569).
CREATE UNIQUE INDEX "album_template_collectionId_name_key" ON "album_template"("collectionId", "name");

CREATE INDEX "album_template_collectionId_idx" ON "album_template"("collectionId");

ALTER TABLE "album_template" ADD CONSTRAINT "album_template_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
