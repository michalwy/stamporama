-- A photo's scale (#2061): the scanning profile (#1443) it was scanned with, or a resolution typed
-- for it — so an offer collage can draw every stamp at one scale whatever each picture came from.
--
-- ## Why the photo carries it
--
-- A collage keeps stamps in their true proportions by assuming every picture was scanned at one
-- resolution, so that pixels stand for millimetres. That holds for tiles cut from card scans, which
-- were all scanned with a profile, but not for a picture added to a copy by hand: another scanner,
-- another resolution, or a phone. So the picture says what it was scanned with, and a collage puts
-- every picture on the coarsest scale among them. **It is never read out of the image file** — the
-- rule scanning profiles already follow: a file's dpi tag is whatever the software wrote, not what
-- the glass measured.
--
-- ## Two columns, at most one set
--
-- `scanning_profile_id` names a profile, and follows its calibration; `scan_dpi` is a resolution
-- typed for the picture when no profile fits — the measuring bar's *Another resolution…*. A whole
-- number, as that field is. Neither is *no scale*: a phone photo, or a picture nobody has said
-- anything about. The resolution is the **upload's**; what a collage needs of the stored, downscaled
-- picture is reckoned from `original_width`, which is what that column is for.
--
-- `NO ACTION` for the reason the other references to a profile give: a profile in use is refused
-- deletion by the app, which says why, and the constraint is the backstop that still lets a whole
-- collection be deleted in one statement.
--
-- ## Tiles cut from a card carry their card's profile
--
-- Written onto the picture when it is cut, so it outlives the scan: deleting a batch keeps the copies'
-- pictures (#1218) and only forgets where they were cut from. The pictures already cut get it here —
-- their card's profile, or the collection's default for a card from before profiles, which is what
-- such a card has always measured with.

ALTER TABLE "photo" ADD COLUMN "scanning_profile_id" TEXT;
ALTER TABLE "photo" ADD COLUMN "scan_dpi" INTEGER;

ALTER TABLE "photo" ADD CONSTRAINT "photo_scale_one_of"
    CHECK ("scanning_profile_id" IS NULL OR "scan_dpi" IS NULL);
ALTER TABLE "photo" ADD CONSTRAINT "photo_scan_dpi_range"
    CHECK ("scan_dpi" IS NULL OR ("scan_dpi" >= 72 AND "scan_dpi" <= 9600));

CREATE INDEX "photo_scanning_profile_id_idx" ON "photo"("scanning_profile_id");

ALTER TABLE "photo" ADD CONSTRAINT "photo_scanning_profile_id_fkey"
    FOREIGN KEY ("scanning_profile_id") REFERENCES "scanning_profile"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

UPDATE "photo" p
SET "scanning_profile_id" = COALESCE(s."scanningProfileId", c."defaultScanningProfileId")
FROM "scan_sheet" s
JOIN "collection" c ON c."id" = s."collectionId"
WHERE p."scanSheetId" = s."id";
