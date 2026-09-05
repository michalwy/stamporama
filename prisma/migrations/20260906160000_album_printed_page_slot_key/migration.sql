-- A printed sheet's index is keyed by the **slot**, not by the stamp (#778).
--
-- A **new migration rather than an edit** to `20260906150000_album_printed_page`, per the standing
-- rule: a migration that has been written is corrected with another one, even one written minutes
-- ago in the same session.
--
-- `album_printed_page_stamp` was keyed `(albumPrintedPageId, stampId)`, which reads correctly until
-- you notice that a stamp can be on **two checklists** — basic and specialized, perforated and
-- imperforate (ADR-0031) — and that an album gathers both from the same area. Two such checklists
-- landing on one sheet is two boxes on that card and two rows here, and the old key made marking
-- that sheet printed fail on a primary-key violation rather than store it.
--
-- The entry is what makes a row a slot, so it belongs in the key.

ALTER TABLE "album_printed_page_stamp" DROP CONSTRAINT "album_printed_page_stamp_pkey";
ALTER TABLE "album_printed_page_stamp"
    ADD CONSTRAINT "album_printed_page_stamp_pkey"
    PRIMARY KEY ("albumPrintedPageId", "albumEntryId", "stampId");
