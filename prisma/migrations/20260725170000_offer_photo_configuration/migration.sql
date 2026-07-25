-- Offer photo configuration on two levels (#308).
--
-- Platform (`contact`): hard technical limits on what the platform physically accepts — all
-- optional, all read live at render time (#310) rather than seeded, because they describe the
-- platform, not the listing. Plus the defaults a new offer is seeded from: which scan sides to
-- include, the per-tile label template (#312), and which collage template (#307) supplies the
-- render numbers.
--
-- Offer: its own copy of sides / label template / collage numbers, seeded at creation and freely
-- editable afterwards. Storing them here rather than reading the platform live means changing a
-- platform setting never silently alters offers already prepared or listed — which matters most for
-- the label template, since a buyer referring to a label on an uploaded image must keep getting the
-- same label after a regeneration (#315).
--
-- The collage columns are nullable as a group: a platform with no default collage template leaves a
-- new offer without render numbers until one is picked on the offer itself.

ALTER TABLE "contact"
    ADD COLUMN "maxPhotos" INTEGER,
    ADD COLUMN "maxPhotoEdge" INTEGER,
    ADD COLUMN "maxPhotoFileSizeKb" INTEGER,
    ADD COLUMN "photoSides" TEXT NOT NULL DEFAULT 'front',
    ADD COLUMN "tileLabelTemplate" TEXT,
    ADD COLUMN "defaultCollageTemplateId" TEXT;

-- SetNull: deleting a collage template must stay possible (nothing else references one), and simply
-- leaves the platform without a default.
ALTER TABLE "contact"
    ADD CONSTRAINT "contact_defaultCollageTemplateId_fkey"
    FOREIGN KEY ("defaultCollageTemplateId") REFERENCES "collage_template"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contact_defaultCollageTemplateId_idx"
    ON "contact"("defaultCollageTemplateId");

ALTER TABLE "offer"
    ADD COLUMN "photoSides" TEXT NOT NULL DEFAULT 'front',
    ADD COLUMN "photoLabelTemplate" TEXT,
    ADD COLUMN "collageRows" INTEGER,
    ADD COLUMN "collageColumns" INTEGER,
    ADD COLUMN "collageGap" INTEGER,
    ADD COLUMN "collageBackground" TEXT,
    ADD COLUMN "collageLabelStripHeight" INTEGER;
