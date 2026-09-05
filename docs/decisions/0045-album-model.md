# ADR-0045: The Album Model — A Durable Printed Artefact With Content-Derived Page Identity

## Status

Accepted, implemented in #767. Decision 8 corrects #766 one commit after it landed. The design it applies is #755. The pieces it reads are #763 (stamp
size), #764 (stamp order within a checklist), #765 (the hawid box rule) and #766 (the album
template); the pieces it hands over to are #768 (the PDF), #769 (the page editor), #770 (the cutting
list) and #778 (printed pages).

## Context

Every other list this app plans is a screen. An album is not: its pages are printed, mounted, and
glued into with material that does not come off again. Roughly 140 such pages already exist for this
collection, hand-written in AlbumEasy's language and filed in binders, and Stamporama's pages will be
filed beside them.

Two consequences follow, and every decision below is one of them applied:

- **A page's identity must not move when the collection grows.** A card in a binder cannot be
  renamed.
- **Anything printed from a derived figure is a derivation that has become a physical object.**

Nothing in the codebase had this shape. The collage track (#307/#310) is the nearest analogue — a
template seeded onto a thing, a pure planner separate from its renderer — and this ADR reuses those
patterns without reusing their reasoning, because a collage is regenerated freely and an album page
is not.

## Decisions

### 1. A page's identity is its catalog range, never a number

A page is called `PL 303-309`, derived from the primary-catalog numbers of the stamps that landed on
it. There is deliberately no page number anywhere in the model — `AlbumPlan` states only the order of
an array.

A number is a *position*. Inserting one stamp early in an album shifts every page after it, so under
numbering, one acquisition would invalidate the label on every card already in the binder. A range is
derived from a page's own contents, so an insertion disturbs the one card it lands on.

This pays a second time in #778: a page that has been printed and later gains stamps can be answered
with a **continuation page** carrying its own range (`PL 305a-305c`) filed straight after the sheet it
continues. Nothing renumbers, because nothing was ever numbered.

**The endpoints are written out in full** — `PL 303-309`, not `PL 303-09`. This is the one place the
app does not apply `formatCatalogRange`'s shortening (#400), which #767 named for it. The shortening
is right wherever a range is read on a screen; here it is printed onto a card filed beside 140
hand-written ones that all write the span out, and a sheet reading `PL 303-09` would announce itself
as coming from somewhere else. It is the same argument that chose Liberation over any other font
(`album-fonts.ts`), one layer up.

### 2. A page's content is a checklist, not an issue

Entries are `Checklist` rows (#531, ADR-0031), gathered from the album's area subtree in catalog
order. A checklist is what counts as one complete unit — basic against specialized, perforated
against imperforate — and that is exactly what a card is laid out for. An issue is a publication
event whose variant tree would burst the card.

Every slot on a checklist gets a box whether or not a copy is owned, which is what makes a page
double as a want list.

One exception, and it is stated on screen rather than left to be discovered: a checklist with no
issue (`issueId` null — one that spans issues) has no area and therefore cannot be gathered. Those
are added by hand.

### 3. A live page is a derivation and is not stored

`planAlbum` runs on read. Nothing about a live page is written to the database, and there is no
`album_page` table in this ADR's migration.

The alternative — materialising the plan and rewriting it — was rejected for the reason #755 rejected
a `frozen` boolean: it makes the plan a cache, and a cache of a derivation goes stale silently. It
would also blur the one distinction the whole design rests on, that a **live page is a plan and only
a printed page is a record**. #778 introduces a page row, and it introduces it for printed pages,
where a row is the right shape because a row is what a snapshot is.

What makes this work is that **every correction that survives a re-flow hangs on an entry, a block or
a stamp, never on a page** — extra space before a block, a box's size delta, stamp order within a
block, a forced break. And nothing *could* hang on a page: a page's identity is derived from its
contents and moves when they do, so a row keyed on it would not be an anchor but a bug waiting for
the collector to insert a stamp.

**There is deliberately no live-versus-previous-live diff.** An earlier draft of #767 asked for one
("a refresh reports what it changed") and the phrase was the flaw: that comparison has no customer,
because a live page reshuffling harms nothing — that is what makes it live. The only comparison
anyone can act on is against paper, and that is #778's divergence report, diffing the live plan
against printed snapshots.

That comparison is **#778's to write**, and #767 ships no part of it. One was written here and then
removed on purpose: #778 has since specified that divergences are reported *in kinds* — text,
structure, size, template — and that a photo added after printing must rank below the first three, or
one bulk scanning session buries every genuine finding. A diff written before that spec would be
reshaped by it, and shipping it early would leave #778 half-rewriting a module everyone assumed was
settled here.

Two notes to save re-deriving it. Pages must be paired **by their contents, not by their names**: a
page's range is derived from its contents, so the moment a page changes at all its identity changes
too, and identity-matching would report every real change as one page removed and another added.
Pairing by greatest shared-stamp overlap works, with pages carrying no stamps paired positionally
since they are indistinguishable. And a page that merely *moved* must be reported as nothing at all —
position is not identity here either, which is the second dividend of decision 1.

Two consequences worth stating. Pages are matched **by their contents** and not by their names, so a
page that merely moved is reported as nothing at all — position is not identity here either. And the
album re-plans on every read: pure arithmetic over a few thousand stamps, the same work the PDF does
to render, and cheaper than the staleness a materialised cache would earn.

### 4. The template's values are copied onto the album, never referenced

`Album` carries the 40 render columns of `AlbumTemplate` and no `albumTemplateId`. This is #308's
rule, and it matters more here than anywhere it has been applied before: editing a template must not
be able to reach into a page that is already in a binder with stamps glued to it.

The duplicated column list is the design, not a normalisation waiting to be tidied away.
`AlbumRenderPreset` in `src/lib/album-template-rules.ts` is what keeps the two lists in step, and it
stays a shared **type** — never a shared row, never a foreign key.

The hawid stock (#765) is the deliberate exception and is read live. It is a statement about a
drawer, and a drawer changes; what must not change under a printed page is the page.

### 5. The album is printed in one language, and it is the album's own

`Album.language` is a non-null ISO 639-1 code. Not the render's, and not the template's, for a reason
stronger than tidiness: **the page plan depends on it.** Headings are longer in some languages,
longer headings wrap, and wrapping changes where a block stops fitting — so the same content does not
break onto pages the same way in Polish and in German. A language chosen at render time would make a
page's catalog-range identity not a property of the album at all, which defeats the stability the
identity exists for.

Not nullable: the collection's default is a real code and is what a new album starts at, so a null
would be a second way of saying what `Collection.defaultLanguage` already says. #777 widens
`getCollectionTranslationContext` to the union of platform and album languages, so an album in a
language nothing is sold in still gets an input in every entity dialog.

### 6. Two levels of order, both editable, and the override is total

`AlbumEntry.sortOrder` is the order the album prints its checklists in, seeded in catalog order.

`AlbumEntryStampOrder` is this album's order for one entry's stamps, overriding the checklist's
collection-wide order (#764). It is written for **every** stamp of the entry or for none: a sparse
override cannot define an order — a stamp placed third with nothing else stated leaves the rest
unanswered — so the first reorder writes the whole list, and the presence of rows is itself what the
page editor (#769) reads to say whether a block is following the checklist's order or the album's.

An entry that agrees with its checklist keeps no rows at all, so an album that has never disagreed is
indistinguishable from one that never could.

### 7. One geometry, two renderers, and one measurer under both

`src/lib/album-layout.ts` is pure millimetre geometry — no Prisma, no PDF library, no React — exactly
as `collage-layout.ts` is pure of `sharp`. The PDF (#768) and the editor canvas (#769) draw the same
plan. Any arithmetic that appears in either of them is arithmetic that lets the screen and the paper
disagree.

The plan needs to measure text, and the layout module may not own the fonts. It therefore takes an
`AlbumTextMetrics` port, and `src/lib/album-metrics.ts` is the **one** implementation both renderers
must use. A canvas that measures with the browser's own `measureText` is the same bug as a renderer
doing its own arithmetic, one level down.

That implementation is currently an **estimate**, because the faces it should measure are the ones
#768 embeds and there are no font bytes in the repository yet. It is safe only because nothing can be
printed before #768 exists: every page it has ever planned is a live page, and a live page re-flows.
The module says so, and says how to replace it.

The obligation that comes with the port is stronger than "there should be one implementation": the
**client is not allowed to measure at all, because the client is not a planner.** #769's canvas draws
a plan computed on the server and its corrections are deltas; dragging shows a geometric offset
applied to an already-computed plan, and the re-plan happens server-side when the drag is released.
So the browser's `measureText` never enters the picture and there is nothing for it to disagree with.

Four packing rules, all of them read off the collector's own pages rather than invented:

- **A chapter is a year and it starts a page**, its heading printed once at the head of it. Every
  `PL-19xx.txt` carries exactly one `HEADER 24 "<year>"` however many `PAGE_START(` it holds.
- **The footer is on every sheet, and the running head is a choice.** PL, DE-BM, DE-BY and DR print
  the album's name at the top of every page from `PAGE_START_GROUP`; **DA prints none**, and starts
  its content at 30 mm where PL starts at 20 because it is not spending those millimetres on a head.
  Hence `printTitle`.
- **A block moves whole.** Only a block taller than an entire page is split, and its continuation is
  marked. A block's height includes its own lead and does not change when it moves — collapsing that
  lead at the top of a page would make "does not fit, so move it" ill-defined, since the block would
  shrink on the way and might then have fitted where it was.
- **Blocks stack in bands, and a band is not a column.** See decision 8.

### 8. Blocks share bands; the page is never divided into columns

#766 shipped `columns` (1–6) and `columnGapMm`, modelling a page split into fixed columns with
content flowing down one and into the next. Building the packer against the source material showed
that the collector does not do this, and the evidence is not ambiguous: his files hold **35** active
`PAGE_COLUMN_START` regions, every one closed by exactly one `PAGE_COLUMN_NEXT` and one
`PAGE_COLUMN_STOP` — always a pair, never three — and `PL-1933.txt` opens **six of them on a single
page**. It is not a page mode. It is two short checklists put side by side, several times down a page,
with everything else full width.

The columns were therefore replaced, one commit later, by `blocksPerBand` and `blockGapMm`
(`20260906120000_album_bands`, a new migration rather than an edit):

- A **band** is a horizontal slice of the page. Consecutive blocks share one when each block's
  **natural width** — its boxes on a single line — fits the share it would get, up to the ceiling.
- The ceiling is a **ceiling, not a target**. One block per band is the ordinary page; pairing is the
  exception.
- A block that does not fit simply does not pair — it takes the next band. **Nothing ever overflows
  sideways**, and no block continues into a neighbour.
- A paired band too tall for an empty page is **unpaired** and its blocks tried singly, so pairing can
  never make a page worse.

A block only joins a band if it fits *without wrapping*: a block that would have to wrap to be paired
is a block the pairing has made worse.

## Consequences

- An album is operational data and gets its own nav screen under **Collection**; the template stays in
  **Settings**, beside the hawid stock.
- #778 can introduce printed pages without changing anything here: `AlbumBlockSpec.printedPageId` is
  the channel, and the planner already steps over a sheet that names one. A stamp that joins a
  checklist whose page is printed appears
  **nowhere** in the plan rather than being appended to the next live page — a deliberate silence,
  and exactly the state #778's continuation page answers.
- #768 replaces `album-metrics.ts` in place and changes no other file.
- #769 attaches its relative corrections to entries and stamps, which survive a re-flow, rather than
  to pages, which are not rows.
- Anyone reaching for a foreign key from `album` to `album_template`, or for an `album_page` table
  holding live pages, is undoing decisions 4 and 3 rather than tidying up. Read this file first.
