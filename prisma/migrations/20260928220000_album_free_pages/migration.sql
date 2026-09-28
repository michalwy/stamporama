-- Pages without stamps (#1429): a title page, a section divider, a map or a page of notes, carrying
-- pictures, headings and texts the collector places freely inside the album's frame.
--
-- ## A free page is anchored to an entry, not positioned
--
-- The same shape `album_text_block` has, for ADR-0045 §3's reason: a live page is a derivation with
-- no row, so a free page cannot be *at* a page — it is filed **before or after an entry** and moves
-- with it when the album re-flows. A null anchor is the head of the album (`before`) or its end
-- (`after`), and a removed entry sets the anchor null rather than taking the page with it.
--
-- Unlike a note, a free page **is** a sheet: it is laid out on paper of its own, so it has the
-- page-level switches a note does not — whether it prints the album's running head, its chapter's
-- heading and the footer. All three are off by default: a title page is not headed by its own title.
--
-- `printedPageId` is the seam notes and continuations already use (ADR-0047 §4): a free page on a
-- card is on that card, and the plan steps over it rather than emitting it again.
--
-- ## Its content is placed exactly, in millimetres from the sheet's top-left corner
--
-- Every other thing on an album page is placed by the layout and corrected by a delta. A free page is
-- the one place the collector places things himself, so an element stores a position — and that is
-- not ADR-0045 §3 broken: the position is on the free page, which is itself a row, and nothing about a
-- re-flow can move it.
--
-- Only the **width** is stored. A text wraps to it and is as tall as its lines; a picture keeps its own
-- proportions and is as tall as the width makes it. A stored height would be a second figure that
-- could disagree with the first.
--
-- ## Pictures are a collection's library
--
-- Uploaded once and used on as many pages, in as many albums, as the collector wants — decided with
-- the collector on 2026-09-28. A row is never changed once written, and deleting one is refused while
-- an element or a printed card names it: `NO ACTION` rather than `RESTRICT` on both, so deleting the
-- collection, which cascades to both sides, is checked at the end of the statement rather than in the
-- middle of it.
--
-- An SVG the frame's ornament reader takes (ADR-0057) is kept as its outlines and prints as vectors;
-- one it refuses is **rasterised once at upload** and prints as that picture, with the reason kept in
-- `rasterReason` so the screen can say why. Decided with the collector on 2026-09-28: a coat of arms
-- with a gradient is worth printing.

CREATE TABLE "album_picture" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "drawing" JSONB,
    "rasterKey" TEXT,
    "rasterReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_picture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "album_picture_collectionId_name_key" ON "album_picture"("collectionId", "name");
CREATE INDEX "album_picture_collectionId_idx" ON "album_picture"("collectionId");

ALTER TABLE "album_picture" ADD CONSTRAINT "album_picture_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "album_free_page" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "anchorAlbumEntryId" TEXT,
    "side" TEXT NOT NULL DEFAULT 'after',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "printTitle" BOOLEAN NOT NULL DEFAULT false,
    "printChapter" BOOLEAN NOT NULL DEFAULT false,
    "printFooter" BOOLEAN NOT NULL DEFAULT false,
    "printedPageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "album_free_page_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "album_free_page_albumId_idx" ON "album_free_page"("albumId");
CREATE INDEX "album_free_page_anchorAlbumEntryId_sortOrder_idx" ON "album_free_page"("anchorAlbumEntryId", "sortOrder");
CREATE INDEX "album_free_page_printedPageId_idx" ON "album_free_page"("printedPageId");

ALTER TABLE "album_free_page" ADD CONSTRAINT "album_free_page_albumId_fkey"
    FOREIGN KEY ("albumId") REFERENCES "album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_free_page" ADD CONSTRAINT "album_free_page_anchorAlbumEntryId_fkey"
    FOREIGN KEY ("anchorAlbumEntryId") REFERENCES "album_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "album_free_page" ADD CONSTRAINT "album_free_page_printedPageId_fkey"
    FOREIGN KEY ("printedPageId") REFERENCES "album_printed_page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One picture or one run of text on a free page. `sortOrder` is the drawing order: a later element is
-- drawn over an earlier one. `role` names which of the template's five faces a text is set in, and
-- `sizePt` the size — the face is the template's, so a free page matches the album's type (#766).
CREATE TABLE "album_free_page_element" (
    "id" TEXT NOT NULL,
    "freePageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "xMm" DOUBLE PRECISION NOT NULL,
    "yMm" DOUBLE PRECISION NOT NULL,
    "widthMm" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'heading',
    "sizePt" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "align" TEXT NOT NULL DEFAULT 'center',
    "pictureId" TEXT,

    CONSTRAINT "album_free_page_element_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "album_free_page_element_freePageId_sortOrder_idx" ON "album_free_page_element"("freePageId", "sortOrder");
CREATE INDEX "album_free_page_element_pictureId_idx" ON "album_free_page_element"("pictureId");

ALTER TABLE "album_free_page_element" ADD CONSTRAINT "album_free_page_element_freePageId_fkey"
    FOREIGN KEY ("freePageId") REFERENCES "album_free_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_free_page_element" ADD CONSTRAINT "album_free_page_element_pictureId_fkey"
    FOREIGN KEY ("pictureId") REFERENCES "album_picture"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Which pictures a printed card carries — the index over `album_printed_page.snapshot`, written from
-- it in the same transaction and from nowhere else, exactly as `album_printed_page_stamp` is. It is
-- what makes *refuse deleting a picture a card in a binder still prints* a foreign key rather than a
-- scan of every snapshot.
CREATE TABLE "album_printed_page_picture" (
    "albumPrintedPageId" TEXT NOT NULL,
    "pictureId" TEXT NOT NULL,

    CONSTRAINT "album_printed_page_picture_pkey" PRIMARY KEY ("albumPrintedPageId","pictureId")
);

CREATE INDEX "album_printed_page_picture_pictureId_idx" ON "album_printed_page_picture"("pictureId");

ALTER TABLE "album_printed_page_picture" ADD CONSTRAINT "album_printed_page_picture_albumPrintedPageId_fkey"
    FOREIGN KEY ("albumPrintedPageId") REFERENCES "album_printed_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_printed_page_picture" ADD CONSTRAINT "album_printed_page_picture_pictureId_fkey"
    FOREIGN KEY ("pictureId") REFERENCES "album_picture"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
