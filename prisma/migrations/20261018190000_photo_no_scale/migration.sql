-- *No scale* as a choice (#2066), apart from a picture never given a scale.
--
-- #2061 stored both as an empty `scanning_profile_id` and `scan_dpi`, and an offer collage drew any
-- such picture by its pixels. Photos added before #2061 are all of that kind, so collages kept coming
-- out with stamps out of proportion. Now a picture **never given a scale is taken at the collection's
-- default scanning profile**, read when the image is drawn — so changing the default changes it — and
-- only a picture **marked *No scale*** (a phone photo, say) stays without one.
--
-- ## Why a column of its own
--
-- The two must be told apart, and neither of the existing columns can say it: both empty is exactly
-- what *never given one* is. A flag set only with both empty, held by a CHECK, keeps the three states
-- — a profile, a typed resolution, *No scale* — mutually exclusive, with *never given one* the absence
-- of all three.
--
-- ## The photos already marked *No scale*
--
-- They cannot be told apart from those never given a scale: #2061 wrote the same two empty columns
-- for both, and copy photos are also added without a scale by paths that never asked (a viewer
-- snapshot, a stamp photo copied onto a copy). So every existing photo starts as *never given one*,
-- and the collector marks a phone photo *No scale* again where it matters.

ALTER TABLE "photo" ADD COLUMN "no_scale" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "photo" ADD CONSTRAINT "photo_no_scale_alone"
    CHECK (NOT "no_scale" OR ("scanning_profile_id" IS NULL AND "scan_dpi" IS NULL));
