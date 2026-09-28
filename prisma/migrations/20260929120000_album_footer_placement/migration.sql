-- Where the page footer sits, positioned on its own rather than as the foot of the content (#1457).
--
-- Template values, copied onto the album like every other (#308's rule).
--
-- - `footerPlacement`: `inside-frame`, `in-frame` (set into the frame's bottom line, the rule broken
--   around it, as #1428 sets the title into the top one) or `below-frame`. `inside-frame` is every
--   page printed before the column existed.
-- - `footerOffsetMm`: measured from the frame's line — up from the inner rule's inside to the foot
--   of a footer inside the frame, down from the outer rule's outside to the head of one below it.
--   Until now the footer's foot sat on the bottom margin, so each row is given the offset that puts
--   it exactly there again: the bottom margin less the distance to the inner rule's inside
--   (`albumFooterOffsetFromMarginMm` in `album-frame.ts`, which a card stored before this column
--   reads its own through). A row whose margin reached past the frame gets 0. The default is then
--   dropped, so every writer states it.
-- - `footerFrameGapMm`: the white each side of a footer set into the frame line; 5 mm, as the
--   title's (#1428). Draws nothing until a template chooses `in-frame`.
ALTER TABLE "album_template"
  ADD COLUMN "footerPlacement" TEXT NOT NULL DEFAULT 'inside-frame',
  ADD COLUMN "footerOffsetMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "footerFrameGapMm" DOUBLE PRECISION NOT NULL DEFAULT 5;
UPDATE "album_template"
  SET "footerOffsetMm" = GREATEST(0, ROUND((
    "marginBottomMm" - "borderInsetMm" - CASE
      WHEN "borderStyle" = 'double' THEN 1.5 * "borderWidthMm" + "borderGapMm"
      ELSE 0.5 * "borderWidthMm"
    END
  )::numeric, 2))::double precision;
ALTER TABLE "album_template"
  ALTER COLUMN "footerOffsetMm" DROP DEFAULT;

ALTER TABLE "album"
  ADD COLUMN "footerPlacement" TEXT NOT NULL DEFAULT 'inside-frame',
  ADD COLUMN "footerOffsetMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "footerFrameGapMm" DOUBLE PRECISION NOT NULL DEFAULT 5;
UPDATE "album"
  SET "footerOffsetMm" = GREATEST(0, ROUND((
    "marginBottomMm" - "borderInsetMm" - CASE
      WHEN "borderStyle" = 'double' THEN 1.5 * "borderWidthMm" + "borderGapMm"
      ELSE 0.5 * "borderWidthMm"
    END
  )::numeric, 2))::double precision;
ALTER TABLE "album"
  ALTER COLUMN "footerOffsetMm" DROP DEFAULT;
