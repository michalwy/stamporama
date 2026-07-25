-- Offer photos panel (#314): record the **copies** each generated image was rendered from.
--
-- `setIds` alone cannot answer "what is in this image": a set holding more copies than the collage's
-- capacity is split into consecutive groups (#309), so several images can carry the same single set
-- id. The panel previews the plan and has to say what each file shows, so the copies are recorded
-- alongside the sets — same reasoning as `setIds`: a plain array, because the entry is a snapshot of
-- what was rendered, and a copy removed afterwards is the staleness the fingerprint reports rather
-- than a referential error to repair.
--
-- Existing rows keep an empty array; the panel then names their sets only, and the next generation
-- run (a full replacement) fills them in.
ALTER TABLE "offer_photo_entry"
    ADD COLUMN "itemIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
