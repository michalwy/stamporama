-- Offer photos can group a set's copies by checklist (#1673), so a series inside a bulk lot is shown
-- together instead of scattered among the singles.
--
-- A switch and a collage template of its own, on both levels the photo configuration already has
-- (#308): the platform says what a new offer starts with, and the offer carries its own copy. The
-- group template is **copied** onto the offer exactly as the singles template is — `CollageTemplate`
-- is seeded, never referenced by an offer — so its numbers are six nullable columns, all null
-- together when no group template was picked; the groups then use the singles numbers.
--
-- Off everywhere: every existing platform and offer keeps generating photos as it does today, and
-- the platform has no group template until the collector picks one.

ALTER TABLE "contact"
    ADD COLUMN "photoGroupByChecklist" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "defaultGroupCollageTemplateId" TEXT;

-- SetNull, like the singles default: a collage template stays freely deletable, and deleting the
-- group default leaves the platform's groups on the singles template.
ALTER TABLE "contact"
    ADD CONSTRAINT "contact_defaultGroupCollageTemplateId_fkey"
    FOREIGN KEY ("defaultGroupCollageTemplateId") REFERENCES "collage_template"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contact_defaultGroupCollageTemplateId_idx"
    ON "contact"("defaultGroupCollageTemplateId");

ALTER TABLE "offer"
    ADD COLUMN "photoGroupByChecklist" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "groupCollageGridMode" TEXT,
    ADD COLUMN "groupCollageRows" INTEGER,
    ADD COLUMN "groupCollageColumns" INTEGER,
    ADD COLUMN "groupCollageGapPercent" INTEGER,
    ADD COLUMN "groupCollageBackground" TEXT,
    ADD COLUMN "groupCollageLabelPercent" DOUBLE PRECISION;
