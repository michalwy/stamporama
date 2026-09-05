-- Printed album pages (#778): the snapshot, the index over it, and the continuation flag.
--
-- ## A printed page is a stored result, not a flag
--
-- The alternative was one boolean on the recompute path, and it is the failure this whole issue
-- exists to prevent: `frozen` would stop the *layout* being re-planned while every text and every
-- dimension went on resolving from live data, so renaming an issue would quietly change what a
-- reprint produces and the reprint would stop matching the card it replaces. So the row keeps what
-- went onto the paper — the resolved texts, the box geometry in millimetres, the stamps and their
-- order, the catalog range that is its identity, the strip each box was cut from, and the render
-- preset the sheet was set under — and is immutable from that moment.
--
-- ## Why the snapshot is JSON and the stamps are rows
--
-- `snapshot` is a **result**. It is written once, read whole by the renderer (#768) and by the
-- divergence report, and never joined against or filtered on; a table of placements would be a
-- normalisation of something nobody queries. What *is* queried, on every read of the album screen,
-- is "which stamps of this album are already on paper" — so that lives in `album_printed_page_stamp`
-- beside it, derived from the same snapshot in the same transaction and written from nowhere else.
--
-- `part` is which sheet of a split block a row belongs to: 1 for an ordinary checklist, 2 and 3 for
-- the tails of one too tall for a page. A block that spans sheets is printed across all of them or
-- across none — half a checklist on paper and half in the live plan is not a state the model allows.
--
-- ## `reprintingAt` is not `frozen` wearing a different hat
--
-- It is the intermediate state of a two-step act #778 states in full: choosing *reprint* returns the
-- sheet's content to the live plan and re-plans it, and *the snapshot is replaced only when the new
-- sheet is marked printed in its turn.* Until then a card matching this row is still in the binder,
-- and the album says so. It changes no resolution and nothing on the row.
--
-- ## `album_entry.continuesPrintedPageId`
--
-- The other of the two answers, and it is per divergence rather than a setting. Set, it says: plan
-- the stamps of this entry that are on no sheet yet, as a block filed after the sheets that already
-- carry it. Cleared when that continuation is itself marked printed, so the next stamp to arrive
-- asks again. Null — the state every entry starts in — is the deliberate silence: a stamp joining a
-- checklist whose card is in a binder appears nowhere until the collector gives it a home.

CREATE TABLE "album_printed_page" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "reprintingAt" TIMESTAMP(3),

    CONSTRAINT "album_printed_page_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "album_printed_page_albumId_printedAt_idx" ON "album_printed_page"("albumId", "printedAt");

ALTER TABLE "album_printed_page"
    ADD CONSTRAINT "album_printed_page_albumId_fkey"
    FOREIGN KEY ("albumId") REFERENCES "album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "album_printed_page_stamp" (
    "albumPrintedPageId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "albumEntryId" TEXT NOT NULL,
    "part" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "album_printed_page_stamp_pkey" PRIMARY KEY ("albumPrintedPageId", "stampId")
);

CREATE INDEX "album_printed_page_stamp_albumEntryId_part_sortOrder_idx" ON "album_printed_page_stamp"("albumEntryId", "part", "sortOrder");
CREATE INDEX "album_printed_page_stamp_stampId_idx" ON "album_printed_page_stamp"("stampId");

ALTER TABLE "album_printed_page_stamp"
    ADD CONSTRAINT "album_printed_page_stamp_albumPrintedPageId_fkey"
    FOREIGN KEY ("albumPrintedPageId") REFERENCES "album_printed_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_printed_page_stamp"
    ADD CONSTRAINT "album_printed_page_stamp_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_printed_page_stamp"
    ADD CONSTRAINT "album_printed_page_stamp_albumEntryId_fkey"
    FOREIGN KEY ("albumEntryId") REFERENCES "album_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "album_entry" ADD COLUMN "continuesPrintedPageId" TEXT;

CREATE INDEX "album_entry_continuesPrintedPageId_idx" ON "album_entry"("continuesPrintedPageId");

ALTER TABLE "album_entry"
    ADD CONSTRAINT "album_entry_continuesPrintedPageId_fkey"
    FOREIGN KEY ("continuesPrintedPageId") REFERENCES "album_printed_page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
