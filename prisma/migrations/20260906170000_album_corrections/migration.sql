-- The page editor's corrections (#769): where the collector overrules the automatic layout.
--
-- ## Every one of these hangs on an entry, a block or a stamp — never on a page
--
-- ADR-0045 §3 is what shapes this whole migration. A live page is a derivation with no row of its
-- own, and its identity is its catalog range, which is derived from its contents and moves when they
-- do. A correction keyed on a page would therefore not be an anchor at all: it would be a bug
-- waiting for the collector to insert one stamp. So a correction hangs on the thing that is stable —
-- the entry, or one box of it — and the automatic layout goes on running underneath, which is
-- exactly what lets a correction survive a re-flow. Adding a stamp re-plans the page and *5 mm more
-- before this series* is still 5 mm more before that series.
--
-- ## The space corrections were counted, the break was not
--
-- `~/Documents/AlbumEasy` holds the collector's own six areas: **480** `PAGE_VSPACE` across **198**
-- `PAGE_START(` pages, which makes extra vertical space by a long way the correction he actually
-- makes — about 2.4 a page. All 18 negative ones are in the `_*.txt` running-head includes, building
-- the head `printTitle` already models; there is not one in page content. Hence `Float`, signed, with
-- the layout flooring a block's lead at zero rather than letting two blocks overlap.
--
-- `breakBefore` has no such corpus. AlbumEasy paginates by hand, so his 198 `PAGE_START(` *are* the
-- breaks and there is no `PAGE_BREAK` directive anywhere in the sources. It is an invention, asked
-- for in #755: `auto` is the packer's answer, `always` starts a sheet, `avoid` asks that a page break
-- not fall above this block. The last is a **preference** — a run of them taller than a sheet has no
-- arrangement that satisfies it, and the packer drops it rather than looking for one.
--
-- ## A box adjustment is keyed on the box, and a box is a slot rather than a stamp
--
-- `(albumEntryId, stampId)`, which reads like over-keying until you know the fact ADR-0047 §2 is
-- built around: **a stamp can be on two checklists of one issue** — basic and specialized,
-- perforated and imperforate (ADR-0031) — and an album gathers both from the same area, so one stamp
-- can have two boxes on one card. Keyed on the album and the stamp, correcting one of them would
-- silently correct the other.
--
-- The two millimetres are added to the **stamp's size, before the box rule runs** (#765), not to the
-- box the rule produced. That is what keeps the height honest: a hawid box's height is not chosen, it
-- is the shortest strip in the drawer the piece fits into, so a correction that moved it continuously
-- would draw a box at a height no strip has — the one thing #765 exists to prevent. Widening far
-- enough to pass a strip's stock length, or raising past the tallest strip, therefore turns the box
-- into a pocket, and the cutting list says so.
--
-- ## A free text block is an invention, and says so
--
-- Counted, like everything else here: `PAGE_TEXT_PARAGRAPH_START` appears **21** times in
-- AlbumEasy's own `examples/` and **not once** in the collector's six areas, and `PAGE_TEXT(` not at
-- all. So this is not read off his pages the way the packing rules and `DEFAULT_ALBUM_PRESET` were;
-- it is asked for in #755 and built as asked.
--
-- It is **anchored to an entry** rather than given a position among them. A position is the thing
-- this whole model refuses to store, and an anchor is what makes a note travel with the series it is
-- about when the collector reorders the album. `afterAlbumEntryId` null is the head of the album —
-- also where a note goes when the entry it was about is taken out of the binder, which is `SET NULL`
-- below. A note that jumps to the top is loud and one drag from being right; a note deleted with its
-- anchor is the collector's own words gone.
--
-- `printedPageId` is the same seam `album_entry.continuesPrintedPageId` is: a text block on a sheet
-- in a binder is on that sheet, and the plan steps over it rather than emitting it again on live
-- paper (ADR-0047 §4).

ALTER TABLE "album_entry" ADD COLUMN "spaceBeforeMm" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "album_entry" ADD COLUMN "spaceAfterMm" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "album_entry" ADD COLUMN "breakBefore" TEXT NOT NULL DEFAULT 'auto';

CREATE TABLE "album_box_adjustment" (
    "albumEntryId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "widthDeltaMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heightDeltaMm" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "album_box_adjustment_pkey" PRIMARY KEY ("albumEntryId","stampId")
);

CREATE INDEX "album_box_adjustment_stampId_idx" ON "album_box_adjustment"("stampId");

ALTER TABLE "album_box_adjustment" ADD CONSTRAINT "album_box_adjustment_albumEntryId_fkey"
    FOREIGN KEY ("albumEntryId") REFERENCES "album_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_box_adjustment" ADD CONSTRAINT "album_box_adjustment_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "album_text_block" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "afterAlbumEntryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'heading',
    "text" TEXT NOT NULL DEFAULT '',
    "spaceBeforeMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spaceAfterMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakBefore" TEXT NOT NULL DEFAULT 'auto',
    "printedPageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "album_text_block_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "album_text_block_albumId_idx" ON "album_text_block"("albumId");
CREATE INDEX "album_text_block_afterAlbumEntryId_sortOrder_idx"
    ON "album_text_block"("afterAlbumEntryId", "sortOrder");
CREATE INDEX "album_text_block_printedPageId_idx" ON "album_text_block"("printedPageId");

ALTER TABLE "album_text_block" ADD CONSTRAINT "album_text_block_albumId_fkey"
    FOREIGN KEY ("albumId") REFERENCES "album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_text_block" ADD CONSTRAINT "album_text_block_afterAlbumEntryId_fkey"
    FOREIGN KEY ("afterAlbumEntryId") REFERENCES "album_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "album_text_block" ADD CONSTRAINT "album_text_block_printedPageId_fkey"
    FOREIGN KEY ("printedPageId") REFERENCES "album_printed_page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
