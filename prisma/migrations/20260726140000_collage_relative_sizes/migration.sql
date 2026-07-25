-- Collage sizes become percentages of the stamp, not output pixels (#312).
--
-- The pixel model asked the collector for a number they cannot know: the canvas is built from scans
-- of an unknown DPI and is then scaled down by one shared factor to the platform's longest-edge and
-- file-size limits, so a 24 px label strip is 24 px of *something* that has not been decided yet.
-- Labels came out unreadable for exactly that reason. A percentage of the stamp height needs
-- neither number: whether a label reads well beside the stamp it names does not change when the
-- whole image is scaled, and an image scaled far enough for the label to vanish has already lost
-- the stamp. The renderer resolves the percentages against the median tile height of each collage.
--
-- Existing values are **not** converted: a pixel number cannot be translated without knowing the
-- scan resolution it was tuned against, and every row predates any readable label being rendered
-- (tile annotation is this very issue). Rows therefore take the new defaults — 5% gap, 14% strip,
-- which puts the label's text at roughly a tenth of the stamp's height — and are re-tuned in the UI
-- if the collector wants something else.

ALTER TABLE "collage_template" RENAME COLUMN "gap" TO "gapPercent";
ALTER TABLE "collage_template" RENAME COLUMN "labelStripHeight" TO "labelPercent";
UPDATE "collage_template" SET "gapPercent" = 5, "labelPercent" = 14;
ALTER TABLE "collage_template" ALTER COLUMN "labelPercent" SET DEFAULT 0;

ALTER TABLE "offer" RENAME COLUMN "collageGap" TO "collageGapPercent";
ALTER TABLE "offer" RENAME COLUMN "collageLabelStripHeight" TO "collageLabelPercent";
UPDATE "offer"
   SET "collageGapPercent" = 5,
       "collageLabelPercent" = 14
 WHERE "collageGapPercent" IS NOT NULL;
