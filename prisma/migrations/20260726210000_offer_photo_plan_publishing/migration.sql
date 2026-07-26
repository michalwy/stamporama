-- The offer photo plan becomes the collector's own upload sequence (#313 follow-up).
--
-- Two additions, both in the plan-token vocabulary introduced with manual attachments:
--
-- 1. `offer.photoPlanUnpublished` — plan tokens marked **do not publish**. Such an image is still
--    rendered and stored (the collector wants to look at it, and a generated collage cannot simply
--    be "removed" the way a manual attachment can), but it is kept out of the upload set: it takes
--    no upload number, is absent from the plan's ZIP, and does not count toward the platform's
--    photo limit — so hiding one can let a previously truncated image back in.
--
-- 2. `offer_photo_entry.token` — the plan identity a stored image was rendered for. Without it a
--    stored file cannot be matched back to its planned entry, which is what the panel now needs in
--    three places: previewing a planned collage with the image actually generated for it, dragging
--    the stored-files list, and marking a stored image do-not-publish.
--
-- The token of a collage side is recoverable from what the row already carries — its side and the
-- copies it shows, sorted so tile order cannot change it — so existing collage rows are backfilled
-- here. Attachment rows cannot be: the entry records the *generated* photo, not which attachment
-- produced it. They stay NULL and are filled by the next run; a NULL token simply does not match.
--
-- Note also what is *not* here: the plan order is not a generation input any more. A reorder is
-- applied to the stored entries directly (`sortOrder` rewritten, bytes untouched), so the plan and
-- the stored files can never disagree about the upload sequence, and reordering no longer marks
-- anything out of date. What the fingerprint gained instead — the *set* of rendered tokens, since
-- order and do-not-publish can change which images fit under the limit — lives in application code.

ALTER TABLE "offer"
    ADD COLUMN "photoPlanUnpublished" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "offer_photo_entry"
    ADD COLUMN "token" TEXT;

-- Backfill the collage rows. `itemIds` is sorted rather than taken in tile order, matching
-- `collageToken()` in `src/lib/offer-photo-plan.ts`.
UPDATE "offer_photo_entry"
SET "token" = 'c:' || "side" || ':' || (
        SELECT COALESCE(string_agg(item, ',' ORDER BY item), '')
        FROM unnest("itemIds") AS item
    )
WHERE "source" = 'collage' AND "side" IS NOT NULL;
