# ADR-0058: Pages Without Stamps Are Sheets Filed Like Notes, Placed in Millimetres

## Status

Accepted and implemented in #1429. The collector raised it on 2026-09-28 with a screenshot of his own
title page; on the same day he settled that there is no special *title page* kind, accepted the
design the issue proposed, and chose the three things it left open — a collection-wide picture
library, an SVG the vector reader refuses printed as a picture rather than refused, and a divergence
kind of its own. Refs ADR-0045 (the album model), ADR-0046 (the PDF), ADR-0047 (printed pages),
ADR-0057 (the frame's ornament reader), #769 (the page editor), #766 (the template's faces).

## Context

Every sheet an album made was a sheet of stamps, and the only thing of the collector's own a sheet
could carry was a note (#769): a block of text packed among the checklists. His own albums also have
pages without stamps — a title page for the album or a section, a map, a page of notes — and those
carry pictures and several texts, arranged by hand, inside the album's frame.

Two rules of this track pull against the obvious implementation:

- **A live page has no row** (ADR-0045 §3). Its identity is derived from its contents and moves when
  they do, so nothing may be stored against a page's position — every correction is a delta hung on an
  entry, a block or a stamp.
- **The canvas and the PDF must agree** (ADR-0045 §7, ADR-0046). The client does not measure, and
  neither renderer does arithmetic the other could do differently.

## Decision

### 1. A free page is a row, filed like a note, and laid out as a sheet of its own

`AlbumFreePage` is anchored to an entry and a side — `AlbumTextBlock`'s shape, for its reason: *after
X* and *before Y* are one gap today and two once the album is reordered. Null + `before` is the
album's opening page, null + `after` its closing one; a removed entry sets the anchor null. Within one
anchor and side a free page goes **outside** the notes, so a note stays next to the checklist it is
about.

In the plan it is a block of kind `page`. It is **never packed**: it closes the page being filled —
unless nothing is on it yet, so a chapter's year heading waiting for its first block is not left alone
on a card in front of it — and is laid out on a sheet of its own. It shares a band with nothing, and a
keep-together cannot cross it. It never answers *which block opens this chapter*, so it never takes a
chapter's year off its first stamp sheet.

The frame is printed on it. The running head, the chapter heading and the footer are the page's own
switches, off by default; each, when on, is placed exactly where every other sheet places it.

### 2. What is on it is placed in millimetres, and only the width is stored

An element — a picture or a run of text — stores a position in millimetres from the sheet's top-left
corner and a width. This is the one place on the track where the collector places something rather
than correcting the layout, and it is not §3 of ADR-0045 broken: the position is on the free page,
which is a row, and no re-flow can move it.

A text wraps to its width, keeping the line breaks typed, and is as tall as its lines; a picture keeps
its proportions and is as tall as its width makes it. A stored height would be a second figure that
could disagree with the first. The plan computes the wrapped lines and the heights — nothing else —
so the canvas draws the same rectangles the PDF does and a text is re-wrapped by the server when it is
widened, never by the browser.

A text is set in **one of the template's five faces** (#766), by role, at a size of its own, left,
centred or right. `AlbumPlacedText` gained an optional size and alignment for this, and
`albumLineStartMm` is where a line starts for both renderers.

Centring is one action, in the sheet's **content area** — what the frame's heads leave — which is the
rectangle every other text on an album page is centred in.

### 3. Pictures are a collection's library, and an SVG prints as lines when it can

`AlbumPicture` is per collection: uploaded once, placed on any page of any album, never changed once
written. An element and a printed card name it by id, both through `NO ACTION` foreign keys — the
card through `album_printed_page_picture`, an index derived from its snapshot in the same transaction,
exactly as `album_printed_page_stamp` is — so the database itself refuses deleting a picture anything
still prints, and a card can reference its pictures rather than copy their bytes.

An SVG goes through the frame's ornament reader (ADR-0057). What it takes is kept as outlines and
prints **as vectors**: the PDF writes the four commands as path operators, and the browser is served an
SVG written from the outlines (`albumDrawingSvg`), never the file uploaded. What it refuses — a
gradient, transparency, text — is **rasterised once, at upload**, through `sharp` (already how every
other pixel here is moved), to 4000 px on its longer side, and prints as a picture; the reader's own
reason is kept so the screen can say why. A file `sharp` cannot draw either is refused. PNG and JPEG
print as uploaded, a JPEG turned upright first since the PDF ignores its orientation tag.

A raster that would print below **300 dpi** at its placed width is flagged in the editor, never
printed — ADR-0047 §9's distinction between what is shown before printing and what goes onto paper.

### 4. On a card, positions are facts, and changes report as `page`

A free page is marked printed like any sheet and is a card of its own. Its snapshot holds the placed
page — every element's rectangle, a text's wrapped lines, face, size and alignment, a picture's id. It
is claimed in the printed index by its own row (`AlbumFreePage.printedPageId`), so it never reads as
orphaned — the trap #769 met with a sheet holding only a note.

The divergence report compares its elements by id, and here **coordinates are facts**: everywhere else
a position is a consequence of the facts above it and is not compared, but on a page the collector laid
out himself where something sits is what he chose. Changed words are `text`; everything else — moved,
widened, set differently, replaced, added, taken off, drawn in another order — is a new kind, `page`,
ranked after `text` and before `template`. A replaced coat of arms is not the low-value `photo` a bulk
scanning session produces.

A card of no stamps cannot be covered by the reprint rule's *every stamp is on a newer card*; it is
discarded when nothing names it any more — marking its replacement printed moves the page's own row
onto the new card. The same now holds for a card carrying only a note.

## Consequences

- The page editor opens a free page by its own id (`?page=<id>`), which is where it goes right after
  one is added, before it can know where the re-plan put it; a position still wins when both are given.
- A free page is left off the cutting list, live or printed: there is nothing on it to cut.
- The template preview draws no free page — a template produces stamp sheets, and a free page is the
  album's own.
- Deleting a free page is refused while it is on a card, a note's rule; editing one is allowed and
  reported.
- The ornament reader's errors carry a `reason` phrase for the refusals that are a choice rather than a
  malformed file, so a picture's fallback can say why in words that are not a corner ornament's.
