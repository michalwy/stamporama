-- #337: the label strip is a percent of the finished image's longest edge rather than of the stamp,
-- and the usable band turns out to be about one to three percent wide. A whole number cannot land
-- inside it — 1 is readable, 2 is already too big — so the column carries fractions.
ALTER TABLE "collage_template" ALTER COLUMN "labelPercent" TYPE DOUBLE PRECISION;
ALTER TABLE "offer" ALTER COLUMN "collageLabelPercent" TYPE DOUBLE PRECISION;
