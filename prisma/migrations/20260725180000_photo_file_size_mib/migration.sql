-- Platform photo file-size limit in mebibytes rather than kilobytes (#308).
--
-- Nothing quotes an image limit in KB any more — platforms state "up to 10 MB" — so the column
-- changes unit as well as name. Any value already stored is in KB and is converted, rounding up so
-- a stated limit never shrinks below what it allowed (and never lands on 0).

ALTER TABLE "contact" RENAME COLUMN "maxPhotoFileSizeKb" TO "maxPhotoFileSizeMib";

UPDATE "contact"
   SET "maxPhotoFileSizeMib" = GREATEST(1, CEIL("maxPhotoFileSizeMib"::numeric / 1024))
 WHERE "maxPhotoFileSizeMib" IS NOT NULL;
