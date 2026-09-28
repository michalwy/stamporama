# ADR-0057: Album Frame Ornaments Are Read Once Into Outlines

## Status

Accepted and implemented in #1427. The collector raised it on 2026-09-28 with a screenshot of his
AlbumEasy `Classic` frame, chose both a built-in set and his own uploads, and on the same day chose
how an ornament meets the rules (§3). Refs ADR-0046 (the PDF), ADR-0047 (printed cards), #766
(the plain border), #795 (the preview).

## Context

An album page could carry a plain border: one or two rules inset from the edge (#766). The
collector's own pages, set in AlbumEasy, carry an ornamental frame — a double rule running into a
rosette at each corner — and the two kinds of card sit side by side in one binder.

Three things had to be true of an ornament, and they pull against the obvious implementation:

- **it prints as vectors at true millimetres** (#768), so it is sharp at any size and a ruler agrees
  with the template;
- **the preview and the PDF draw the same thing** (#795) — and they already did not for the plain
  border: the PDF left 1.2 mm between a double rule's pair, the canvas 1 mm;
- **the collector can upload his own**, as SVG, and nothing he uploads may reach a browser as markup.

pdf-lib draws SVG *path data* and nothing else of SVG. A browser draws all of SVG, differently from
pdf-lib wherever the two disagree. Handing both the uploaded file would be two renderers of one file.

## Decision

### 1. An upload is read once, into outlines, and the outlines are what everything draws

`src/lib/album-ornament-svg.ts` reads an SVG into an `AlbumOrnamentDrawing`: its `viewBox`, and a list
of paths written with **four commands** — move, line, cubic, close — in absolute coordinates with every
transform already applied, each with a solid fill and stroke, a fill rule, a line weight, a cap and a
join. Shapes become paths, arcs and quadratics become cubics.

The drawing is stored in `AlbumOrnament.drawing`; the file stays in storage as it came
(`<collectionId>/ornaments/<id>/original.svg`) and is never read again to print. The PDF writes the
four commands as its own path operators (`album-pdf.ts`); the canvas writes them as `<path>` elements
(`page-canvas.tsx`). Neither parses SVG, and no uploaded markup reaches a page.

### 2. A subset, refused by name outside it

Paths, rectangles, circles, ellipses, lines, polylines and polygons, in groups with transforms, painted
by attribute, inline style or a stylesheet of class rules. Text, embedded pictures, `<use>`, gradients,
patterns, clipping, masks, filters, dashes and partial transparency are **refused with the reason** —
the rule ADR-0046 §5 applies to a face this build does not ship: a card printed without the gradient
the collector drew is wrong in a way only the card shows. Things that draw nothing (metadata, `<defs>`,
an editor's namespaced elements) are passed over.

The XML reader is hand-rolled and small rather than a dependency. It reads elements, attributes, text,
comments, CDATA and a DOCTYPE, and expands no entity beyond XML's five and character references — so a
file cannot make it do more work than its length. A general XML library would bring entity expansion
and namespaces this subset has no use for, and ADR-0051 is the precedent for a narrow hand-rolled
reader where the surface is this small.

### 3. The drawing carries its own alignment

Decided with the collector: **the rules end at the ornament**. An ornament is drawn for the top-left
corner; its point (0, 0) is laid on the corner of the frame's **centre line** (the rule, or midway
between two); it is scaled so its `viewBox`'s longer side is the ornament size; it is **mirrored** —
never rotated — at the other three corners; and the rules run between the ornaments, stopping at the
far edges of their `viewBox`es. A drawing whose frame starts at `0 0` sits inside the corner; one that
starts negative reaches out past the rule, as `Classic`'s rosette does.

So no offset or padding setting exists: the SVG says where it sits. `src/lib/album-frame.ts` is the one
place this is worked out, for the PDF and the canvas alike — which also ends the 1 mm / 1.2 mm
disagreement, since the gap is now a template value (`borderGapMm`) both read through it.

### 4. The built-in set is drawn for Stamporama, through the same reader

`src/lib/album-ornaments.ts` holds four ornaments written as SVG and read through §1's reader, so a
built-in and an upload are one kind of thing from there on. **None is a copy** of AlbumEasy's or anyone
else's art, which is not the application's to redistribute.

### 5. A preset names an ornament; a printed card copies it

`frameOrnament` on a template and an album is a plain string — `none`, a built-in's key or an upload's
id — like every other preset value (#308's rule: copied, never referenced by a foreign key). A save
naming an upload checks it is the collection's. An upload is **immutable**; a different drawing is a
new upload, and deleting one is refused while a template or an album names it.

A printed card stores the **drawing itself** in its snapshot (ADR-0047 §1) beside the preset's name
for it. The name is what the divergence report compares; the drawing is what a reprint draws. A
built-in redrawn by a later build, or an upload deleted, never reaches a card.

## Consequences

- The frame is **paint, not layout**: none of `borderGapMm`, `frameOrnament` or `frameOrnamentSizeMm`
  moves a block, and changing them re-plans nothing. A printed card still reports them as a template
  change, because the card would now look different.
- **Amended by #1428**: the album title can be set into the frame's top line. That choice is layout —
  the title gives its line back to the content — so the plan places the title (on the centre line of
  §3) and `album-frame.ts` only breaks the rules around the rectangle it is handed, which for a printed
  card is the card's own. The frame module still decides nothing about the plan.
- A preset's comparison stays a comparison of primitives, so the divergence report needed nothing new.
- A drawing too detailed (4 000 paths, 120 000 commands) or a file over 1 MB is refused at the upload,
  so a card's snapshot cannot grow by megabytes.
- An SVG a drawing program writes with features outside §2 has to be simplified before upload — text
  converted to outlines, gradients flattened. The refusal names which.
- #1429 reads a free page's SVG pictures through the same reader ([ADR-0058](0058-album-free-pages.md)),
  so a picture that prints as lines is exactly as safe as an ornament. What the reader refuses there is
  not refused but rasterised once at upload, and the reader's errors now carry a `reason` phrase for
  the refusals that are a choice (a gradient, transparency, text) so that fallback can say why.
- Existing templates and albums were migrated to `none` and a 1.2 mm gap — exactly what they printed
  — while a **new** template starts with the Rosette at 25 mm on a double rule, the shape of the
  collector's `Classic.txt` (`IMAGE_SCALE(0.12)` of a 212 px corner).
