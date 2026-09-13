-- A row of boxes broken by hand (#1214): *a new row starts at this stamp*.
--
-- On an album page a checklist's boxes run left to right and wrap only when the page runs out of
-- width (#767). The collector often wants a row to end earlier — a sub-series on its own line, 7 + 3
-- split as 5 + 5, a design kept together — and until now the only break the page editor had was a page
-- break between whole blocks (#769).
--
-- ## Anchored to the box, not to a place on the page
--
-- ADR-0045 §3, as for every correction before it: a live page has no row, so a break stored against a
-- position would be undone by the next stamp bought. `(albumEntryId, stampId)` names one box — a box
-- is a slot, and one stamp can be on two checklists of one issue (ADR-0047 §2) — so adding or removing
-- another stamp re-flows the rows and the break stays in front of the stamp it was set on.
--
-- ## Its own table, not a column on `album_box_adjustment`
--
-- That table says *this piece of hawid is a different size*, deletes its row when both deltas are
-- zero, and is cleared whole by *undo every box correction*. A break is about the row and not the
-- piece; folding it in would make the first of those rules delete breaks and the second undo them.
--
-- ## A break only adds a row
--
-- Nothing here forces an overflow: a row still wider than the page after its break wraps as it always
-- has. That rule lives in `album-layout.ts`; this table only records where the collector asked.

CREATE TABLE "album_row_break" (
    "albumEntryId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,

    CONSTRAINT "album_row_break_pkey" PRIMARY KEY ("albumEntryId","stampId")
);

CREATE INDEX "album_row_break_stampId_idx" ON "album_row_break"("stampId");

ALTER TABLE "album_row_break" ADD CONSTRAINT "album_row_break_albumEntryId_fkey"
    FOREIGN KEY ("albumEntryId") REFERENCES "album_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_row_break" ADD CONSTRAINT "album_row_break_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
