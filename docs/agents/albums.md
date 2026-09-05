# Albums

Printed album pages: what a page is, and what its boxes are cut from. The design was decided in
**#755** — read that issue before anything here, it is the reasoning this file only summarises — and
is being built out in #763–#771 and #777/#778. The model itself is **ADR-0045** (#767); printed
pages are **ADR-0047** (#778).

The rule that runs through all of it: **an album is a durable, printed object, and the app's job is
to plan it, not to render it once.** Pages get glued into. Two things paper cannot take back:

- a page's identity must not move when the collection grows (hence a **catalog range**, `PL 303–309`,
  never a page number — a number is a position, and a position moves);
- a hawid cut to the wrong size is gone.

## Count something in the sources before you write the code

`~/Documents/AlbumEasy` holds the collector's own albums — roughly 140 printed, mounted pages across
six areas, written by hand in AlbumEasy's language. **It is the ground truth for this whole track,
and the issues are downstream of it.**

That reads backwards at first, which is why it is stated here: an issue looks like a specification
and a folder of `.txt` files looks like background. On this track it is the other way round. The
issues were written *from* those pages, so where the two disagree the pages are what actually exists,
and the issue is a paraphrase that lost something.

Two decisions in #767 were built wrong from confident issue text and put right by **counting**, not
by reasoning about it:

- #766 modelled the page as fixed columns with content flowing down one and into the next.
  `grep -c '^PAGE_COLUMN_START'` across the sources gives **35**, with **35** `PAGE_COLUMN_NEXT` and
  **35** `PAGE_COLUMN_STOP` — every region a pair, never three — and `PL-1933.txt` opens **six on a
  single page**. Not a page mode: two short checklists placed side by side, repeatedly, down a page.
- The album title was built as an unconditional running head. Every area's `PAGE_START_GROUP` carries
  one `HEADER` except **DA**, which carries none — and sets `PAGE_SET_VERTICAL_POS(30)` where PL sets
  `(20)`, the 10 mm being exactly the head it is not printing. Hence `printTitle`.

Neither was settled by argument. Both took one `grep -c` against a corpus that was sitting right
there. When an issue and the sources could disagree — page geometry, headings, what is printed where
— count first.

Note that the defaults in `DEFAULT_ALBUM_PRESET` (#766) and the packing rules in `album-layout.ts`
(#767) are all measured from these files, and each says which line it came from. Anything added later
should be able to do the same, or should say plainly that it is an invention.

## Hawid stock and the box rule (#765)

`HawidStrip` is a collection-level dictionary — height, the stock length a strip is sold at, an
optional label, a drag order — shaped and placed like `StampFormat`, edited in **Settings → Albums**.
Nothing is seeded and nothing is backfilled.

`src/lib/hawid.ts` is the rule, and it is **pure**: no Prisma, no rendering. Four surfaces will draw
from it — the page plan (#767), the PDF (#768), the editor canvas (#769) and the cutting list (#770)
— and the only way four surfaces agree on a millimetre is that none of them does the arithmetic.
`src/lib/hawid-stock.ts` is the Prisma side and the rule knows nothing about it.

What the rule says, and why each half is the way it is:

- **Height comes out of the drawer.** The box takes the height of the *shortest strip in stock* that
  the stamp plus the template's vertical clearance fits into. Not the stamp's height plus a margin:
  hawid is sold as strips of a fixed height that are cut across, so a box drawn at a height no strip
  has is a page that disagrees with the piece on the desk. Ties go to the earlier strip in the
  collector's order, so two callers cannot resolve one stamp two ways.
- **Width is the cut,** and is continuous: the stamp plus the template's horizontal margin.
- **A strip must also be long enough** for the box's width. A 210 mm strip cannot yield a 240 mm
  piece however tall it is, and a cutting list must not ask for a cut nobody can make.
- **Oversize is an answer.** A stamp no strip is tall enough for gets a box of its own size plus the
  margins and **no strip** — those go in a pocket, and #770 says so rather than naming a strip that
  does not exist.
- **An empty stock makes every box oversize.** Deliberately: that is a collection which has not
  described its drawer, and it should look unplanned rather than silently take AlbumEasy's global
  4 mm — the single global adjustment this whole rule exists to replace.

Millimetres are rounded to a tenth **before** any comparison. `23.9 + 0.1` is not `24` in binary
floating point, and the strip that mismatch picks is a taller one: material spent on an arithmetic
artefact.

The clearances themselves are **not** here — they belong to the album template (#766) and are passed
in. The rule takes plain numbers on purpose; it is unit-tested on plain numbers in
`tests/unit/hawid.test.ts`.

## The album template (#766)

`AlbumTemplate` is a collection-level **render preset** — page, spacing, hawid clearances, a face and
size per type role, box treatment, photos, and four texts — edited in **Settings → Albums** beside
the stock. It is `CollageTemplate`'s analogue and follows #307/#308's decisions rather than parallel
ones.

`src/lib/album-template-rules.ts` is the pure half: bounds, parsing, and `AlbumRenderPreset`, the
type an `AlbumTemplate` is *plus an id and a name*. #767's `Album` embeds the same preset, and that
shared type is the only thing keeping the two field lists in step.

**It stays a shared type — never a shared row, never a foreign key.** The duplicated columns are the
design, not an oversight waiting to be normalised: choosing a template copies it, so editing one
cannot reach into a page already in a binder. That is #308's rule, and paper is why it is stricter
here.

The defaults are **measured, not invented**: `DEFAULT_ALBUM_PRESET` is the geometry of the
collector's own AlbumEasy sources — A4, 10 mm margins, `ALBUM_PAGES_SPACING (1.0 6.0)`, and
`STAMP_BOXES_SIZE_ADJUST(4)` split across the two clearances that single global figure becomes.

### Fonts are a fixed set (`src/lib/album-fonts.ts`)

A face is a **family and a style** — the unit `ALBUM_DEFINE_FONT("Arial Bold Italic")` names — so
there are no per-role weight columns. Two families ship: Liberation, metrically compatible with the
Times New Roman and Arial roughly 200 already-printed pages are set in, and Noto. #768 embedded the
bytes (`src/fonts/album/`) and verified the coverage — see the PDF section below; the Greek and
Cyrillic question this file recorded as open is answered, and one small real gap replaced it.

There is deliberately **no mono face**. The case for one is aligning columns of catalog numbers, and
it fails on the material: text faces already advance digits equally (Arial 1139, Times 1024 units),
catalog numbers are not pure digits, and labels are centred under boxes of differing widths. Note
also that pdf-lib exposes no OpenType feature selection, so `tnum` is unreachable — a face's default
figures are the figures you get.

Type sizes are in **points**, geometry in millimetres. Points is what type is set in and what a PDF
is drawn in; millimetres is what gets cut.

### The texts reuse the offer vocabulary, scoped per role

No album-only token engine exists. The four texts are `{token}` templates over
`src/lib/offer-title-template.ts`, and what the album needed was added *there*: `{issueDate}` as a
stamp fact beside `{denomination}`, and `{albumName}` / `{checklistName}` / `{pageRange}` on
`ListingTemplateContext` exactly as `{offerUrl}` rides there.

The vocabulary is exposed as **four per-role lists** (`ALBUM_CHAPTER_TOKENS`,
`ALBUM_CHECKLIST_TOKENS`, `ALBUM_BOX_LABEL_TOKENS`, `ALBUM_FOOTER_TOKENS`), not one. A flat list
would offer a footer `{checklistName}` and a chapter heading `{pageRange}`; on an offer that is a
puzzled collector, on an album it is a gap printed on a mounted card.

Two role decisions worth keeping:

- A **chapter is a year group**, so its heading names the year and the area and nothing issue-scoped
  — including where a year group happens to hold one issue. A heading whose shape changes with the
  data produces a printed run nobody can account for.
- A **box label names a catalogue slot**, not an owned copy, so condition, location and copy number
  are absent. Its default is `{catalog::}`: the empty vendor list means the area's primary catalogue
  and the empty flags mean no prefixes, because a page is already one area and one catalogue.

`{issueDate}` resolves the **earliest** date among the stamps in scope, and precision is not
earliness — an absent month or day sorts last within its year rather than first. Its format is a
token argument (`roman` default, `numeric`, `iso`) rather than a setting: Roman month numerals are a
convention nothing else in the codebase produces, and a per-collection setting is what that turns
into if it is left implicit.

## Stamp size (#763)

A box needs a size, and a size is a `Stamp` attribute — catalogue identity, not condition — resolved
through `src/lib/stamp-size.ts`. A stamp stating no size of its own borrows a checklist neighbour's
**at read time**, and anything drawn from a borrowed figure has to say so: a collector cutting to an
inherited number as if it had been measured is the failure this whole track is arranged against.

## The album and its page plan (#767, ADR-0045)

`Album` is anchored on a `CollectionArea`, carries a name, a language and the 40 render columns
copied from a template, and holds `AlbumEntry` rows — **checklists** (#531, ADR-0031), gathered from
that area's subtree in catalog order. A checklist with no issue has no area and cannot be gathered;
it is added by hand, and that is the only exception in the model.

Read **ADR-0045** before changing any of this. What follows is the map, not the reasoning.

### The four things that are easy to undo by accident

- **There is no `albumTemplateId`.** The duplicated render columns are #308's rule at its strictest —
  see below.
- **There is no live-page table**, and **no live-versus-live comparison anywhere.** `planAlbum` runs
  on read; only a printed page is ever a row. A live page reshuffling harms nothing — that is what
  makes it live — so the only comparison with a customer is against paper, and that is the printed
  section below. (An early draft of #767 asked for a refresh report; the bullet was rewritten, the
  screen has none, and the diff was written in #778 against the ranked-kinds spec instead.)
- **A page has no number.** `AlbumPlan` states only the order of an array. A number is a position,
  and a position moves.
- **`Album.language` is not decoration.** The plan depends on it: headings wrap, and wrapping moves
  where a block stops fitting.

### `album-layout.ts` is the geometry, and it is the only geometry

Pure millimetres — no Prisma, no PDF library, no React. The PDF (#768) and the editor canvas (#769)
draw the same plan, and anything either of them computes for itself is what lets the screen and the
paper disagree. `album-plan.ts` is the Prisma side: it resolves sizes (#763), boxes them (#765),
renders the texts in the album's language, and names each page.

Four packing rules, none invented — all four read off the collector's own ~140 AlbumEasy pages,
which is the standard #766's defaults were measured to:

- a **chapter is a year and it starts a page**, its heading printed once (one `HEADER 24 "<year>"`
  per file, however many `PAGE_START(` it holds);
- the **footer is on every sheet**, and the **running head is a choice** (`printTitle`): PL, DE-BM,
  DE-BY and DR print the album's name at the top of every page; **DA prints none** and starts its
  content at 30 mm where PL starts at 20;
- a **block moves whole**, and only a block taller than a page splits. A block's height includes its
  own lead and never changes when it moves — collapse that lead at the top of a page and "does not
  fit, so move it" stops being well-defined, because the block would shrink on the way;
- blocks stack in **bands**, and a band is not a column — see below.

### A band is not a column, and #766's `columns` was wrong about this

`blocksPerBand` / `blockGapMm` replaced #766's `columns` / `columnGapMm` one commit after they
landed (`20260906120000_album_bands`, a new migration — never an edit). The correction matters
because `PAGE_COLUMN_START` in the AlbumEasy sources reads exactly like a page column mode until you
count them: **35** active regions, every one closed by exactly one `PAGE_COLUMN_NEXT` and one
`PAGE_COLUMN_STOP` — always a pair — and `PL-1933.txt` opens **six on a single page**. He is putting
two short checklists side by side, several times down a page, and running full width everywhere else.

So: consecutive blocks share a band when each one's **natural width** (its boxes on a single line)
fits the share it would get, up to the ceiling. The ceiling is a ceiling, not a target. Nothing ever
overflows sideways, no block continues into a neighbour, and a paired band that will not fit an empty
page is **unpaired** rather than allowed to make the page worse.

### Text measurement is a port, and the client may not have one

`AlbumTextMetrics` is injected and `album-metrics.ts` is the one implementation. The obligation is
sharper than "share it": **the client does not measure, because the client is not a planner.** #769's
canvas draws a server-computed plan and its corrections are deltas — dragging shows a geometric
offset on an existing plan, and the re-plan happens server-side on release. The browser's
`measureText` never enters the picture.

Since #768 that implementation measures the **embedded faces' own advances**; #767's estimated table
is gone, and it is not coming back. It reproduces pdf-lib's `CustomFontEmbedder.widthOfTextAtSize`
exactly — the sum of the glyphs' `advanceWidth` over `unitsPerEm`, times the size — which is also
what pdf-lib writes into the document's `W` array and therefore what a printer advances by. Two
details are copied from that function rather than improved on: the **raw** advances rather than the
run's positioned ones (pdf-lib draws glyph ids in a plain show-text operator, so nothing kerns on
the paper), and `layout()` with no feature list.

The ground-truth check survives and is now made against real glyphs: the three headings the collector
left on one line measure 124.7, 147.0 and 164.4 mm inside his 190 mm content width, and the one he
broke by hand with a literal `\n` measures 211.5.

`albumBaselineOffsetMm` sits beside the port rather than in it. The layout never asks where the ink
inside a line falls — it reserves whole lines — but both renderers must agree, and a renderer that
works the offset out for itself is a renderer that can work it out differently. Reading the face for
*that* is safe in a way reading it for the 1.2 line height would not be: it moves ink inside a band
whose height is already fixed, so no page break can depend on it.

### A page range is written out in full

`PL 303-309`, not `PL 303-09`. The one place the app does not apply `formatCatalogRange`'s
shortening (#400), and #767 does name that module for this — the deviation is deliberate and decided
with the collector: the range is printed onto a card filed beside 140 that write the span out.
The **separator stays the app's hyphen**, though: his own sources use an en dash in
`PAGE_START(303–309)` and that was put to him too — one mark across the footer, offer titles and lot
names beat matching a dash at 8 pt. Only the shortening is the album's own. Both were asked and
answered; neither is an oversight to fix.

### The seam #778 picked up

A block already on paper names its sheets in `AlbumBlockSpec.printedPageIds` — a **list**, because a
checklist too tall for a page is split across two or three cards and all of them are in the binder —
and the planner steps over it whole. Two consequences are deliberate: a stamp on a printed page is
not in the live plan at all, and a stamp that **joins** a checklist whose page is printed appears
**nowhere** rather than being appended to the next live page. That silence is the state the
continuation page answers, and inventing a home for the stamp would hide the thing the collector
needs to be told.

### Two sharp edges worth knowing

- A chapter is **grouped** by `Issue.year` but its default heading is `{year}`, which resolves from
  the **stamp's** own `issuedYear` (#766 chose that token). They agree on ordinary data and can
  disagree on odd data; `{issueYear}` is available if that ever bites.
- Chapters are **runs** of consecutive entries sharing a year, not year buckets. Reordering entries
  so years interleave produces two chapters headed 1938 rather than silently pulling them back
  together: a layout that re-sorts what the collector arranged is one they cannot predict, and this
  one is printed.

## The PDF (#768, ADR-0046)

`src/lib/album-pdf.ts` draws the plan and **decides nothing**. Three kinds of arithmetic and no
others: millimetres to points, the plan's top-left origin to the PDF's bottom-left one, and centring
an already-wrapped line with the measurer the plan wrapped with. A fourth kind belongs in
`album-layout.ts`; anything worked out here is something #769's canvas can work out differently.

pdf-lib 1.17.1 with `@pdf-lib/fontkit`, and the choice was **settled on printed paper before the
work started** rather than argued — a 150 mm and a 200 mm rule both measured true, boxes measured
true, a JPEG scaled to its box and not to its own pixels, diacritics through embedded TTFs with
subsetting on. PDFKit does not need evaluating again. One constraint came out of it and is
load-bearing: **pdf-lib exposes no OpenType feature selection**, so `tnum` is unreachable and a
face's default figures are the figures you get.

The bytes are in `src/fonts/album/` — 24 files, 8.7 MB, one per face id, opened by
`album-font-bytes.ts`, which is the **one** module that opens a font file and is what keeps the
measurer and the embedder on the same glyphs. Read that directory's README before touching them: it
carries the provenance, and two things that are easy to get wrong. **Liberation Sans Narrow is not
OFL** — it exists only as 1.07.x under GPL v2 with the Red Hat font exception, and shipping it was
decided rather than assumed. And #766's open coverage question is **closed by measurement**:
Liberation Serif and Sans 2.1.5 carry Greek and Cyrillic in full, checked against the collection's
whole language set (#777 — album languages, not platform languages) in
`tests/unit/album-fonts.test.ts`. One real gap remains, pinned there rather than discovered on a
card: Liberation Sans Narrow has no `ẞ`.

A **continued block is marked `[2]`, `[3]`, …** in its repeated heading, from the second sheet on.
His own pages append `(cd.)`; a number was chosen instead because `(cd.)` cannot say *which*
continuation, and bracketed digits need no per-language table — which an album carrying its own
language would otherwise have forced, that or a fifth template field.

**The mark is made in `album-layout.ts`, and this is the part to get right.** That module leaves
*how a continuation is marked* to the renderer, and the obvious reading — append it while drawing —
is wrong: the plan would have measured the unmarked heading and the drawing would put ink outside
the width the layout reserved, exactly where headings are longest, since a heading that fills its
block is the one most likely to be continued. So the string the plan measures **is** the string
that gets printed: page one charges the unmarked heading and pages two onward the marked one
(`albumContinuationHeading`, `measureHeading`), each measured as its page is made. Nothing is
circular — whether the block splits at all is settled before any mark exists. `AlbumPlacedBlock`
carries `part: number` in place of `continued`, which is the ordinal the mark is written from.

The position selector is **for live plans only**, and `album-print-rules.ts` says so: a position
means something only against the plan that produced it, so it is never stored, and #778's *reprint
this card* must reach for the printed page's catalog range instead.

Three more rules worth not re-deriving:

- A face this build no longer ships is **refused by name** when drawing, and **fallen back on** when
  measuring. The asymmetry is the point: a screen is a derivation and re-renders, a card is glued
  into a binder.
- A photo **fits, never crops**, and comes through `src/lib/storage/` as a `work` read. One that
  cannot be read leaves an empty mount and logs — refusing the sheet would cost the other forty
  boxes on it.
- Sheets are chosen by **position** (`?sheets=2-4`), which is a request and not an identity. A page
  is named by its catalog range and never numbered; these numbers are typed by the listing on
  screen, are true only for it, and are printed onto nothing.

**Nothing is stored.** The file is composed on demand from a plan that is itself a derivation, so
there is nothing to go stale and nothing to sweep. If one is ever kept it is generated bytes and
takes a TTL, per `storage-and-jobs.md`.

And the part server-side composition cannot fix: **the sheet must be printed at 100% / Actual
size**. Printers cannot print to the edge, so the dialog defaults to *Fit to page* and shrinks
everything by a few percent, and a card printed that way looks entirely normal. It is said in
`docs/user-guide/albums.md`, on the download's own tooltip, and in ADR-0046. Measuring on a screen
proves nothing — a viewer applies its own zoom.

### What re-reading the geometry turned up

#768 was told to construct the rare shapes deliberately rather than trust #767's green suite, and it
found a third bug of the same family. **"Taller than an entire page" was measured against the page
being filled.** On a chapter's first page that is short by the year heading, so a 252 mm checklist
met a 235 mm chapter page and was *split across two cards and marked Continued* on a template whose
ordinary page holds 260 mm — a block that moves whole by the stated rule. It is now measured against
`fullContentHeightMm`, an ordinary empty page, and the chapter heading gets the sheet it was
entitled to.

The shapes are in `tests/unit/album-layout.test.ts` under "on the rare shapes": a block spanning
three pages (not two — #767's splitter was wrong only from three), a chapter heading alone on its
sheet, a single oversize mount that fits nothing and must be placed overhanging, and a band unpaired
because its second block is taller than any page. Note while you are there that a band is as tall as
its **tallest** block and never the sum, so unpairing can only ever help when the *first* block
alone fits the space left.

### The shape all three bugs had

Worth stating, because #769, #770 and #778 are all about to write code of the same kind. The three
bugs this module has shipped are one bug:

- a splitter that closed over its **caller's** page variable rather than the page it had just
  filled;
- a template field read from the schema rather than from the **page frame** that was supposed to
  carry it;
- *taller than an entire page* measured against **the page being filled** rather than an ordinary
  empty one.

Each is **a measurement taken against the wrong reference, where the wrong reference is the common
case and the right one is rare.** The first page of a split is the caller's page; an ordinary page is
a full-height page; the two agree on every input anyone would think to test. A suite built from
realistic pages therefore stays green over all three, and none of them was found by running the
tests. So when you take a figure off something here, name what it is a figure *of* — and then build
the input where the two disagree.

The consequence of the third fix is one to leave alone: **a year heading can now sit on a sheet by
itself**, where the chapter's first page is short by that heading and the block under it needs a full
one. That is what "a block moves whole" costs. Pulling a later checklist forward to fill the gap
would break catalogue order, and splitting is the bug that was just fixed; #769 is where the
collector closes such a gap by hand, on the pages where it actually bothers him, which is the right
place for a judgement about paper.

### The second family: re-emitting what a printed sheet already holds

#778 shipped two bugs and they are **not** the measurement family above. Their shape is *the live
plan producing again something a printed sheet already accounts for*:

- a printed sheet was **filed twice** when the entries had been reordered after printing, so one card
  in the binder was listed twice, drawn twice and reprintable twice;
- a chapter whose first block is on paper **printed its year again** on a live sheet, so an album
  with every chapter printed was a run of blank year-headed cards filed in front of the real ones.

Both were unreachable until a sheet could actually be printed, which is why #767's suite was green
over them, and both look correct in isolation — the sheet really is where that block is, the chapter
really does start there.

**So: anything that steps over printed sheets must ask what they already account for.** The list so
far is position, chapter heading and stamps, and it is not obviously closed. #769's canvas and #770's
cutting list both step over them, so both should be built against an album with **every page
printed** and one whose entries were **reordered after printing** — the two inputs that separate
"stepped over" from "left out".

## Printed pages (#778, ADR-0047)

The comparison against paper, and everything a card in a binder knows about itself. **Read ADR-0047
before changing any of it**; what follows is the map.

### A printed page is a stored result, not a flag

`AlbumPrintedPage.snapshot` keeps what went onto the paper — the resolved texts already wrapped, the
placed box geometry in millimetres, the stamps and their order, the catalog range, the strip each box
was cut from, the `Photo.id` each mount printed, and the **render preset the sheet was set under**. A
renderer drawing it resolves nothing.

A `frozen` boolean on the recompute path is the bug this exists to prevent: it stops the *layout*
being re-planned while every text and every dimension goes on resolving live, so renaming an issue
would quietly change what a reprint produces. The point is that a reprint a year later is the same
sheet.

Two things fall out of that and are easy to undo:

- the **strip is copied**, not referenced — the stock is the one thing read live (#765), and a drawer
  changes;
- `album-pdf.ts` takes an `AlbumRenderPreset` **per sheet**. A card is set in the faces and margins it
  was printed in, which an album that has since changed template no longer names anywhere.

`album_printed_page_stamp` beside it is an **index derived from that snapshot in the same
transaction**, written from nowhere else. It exists because the planner asks *is this block on paper*
on every read, and answering that from the snapshots would load a few hundred pages of geometry to
look at a list of ids.

It is keyed `(page, entry, stamp)`, and that reads like defensive over-keying until you know the fact
about how he collects that it is there for: **a stamp can be on two checklists of one issue** — basic
and specialized, perforated and imperforate (ADR-0031) — and an album gathers both from the same
area. Two such checklists on one sheet is **two boxes on the card**, so it is two rows here, and the
first version of this key refused to store that sheet at all.

The same fact reaches past this table. **The unit on a card is a box, and a box is a slot, not a
stamp**: anything that counts what a card needs — #770's cutting list above all — counts boxes, or it
tells the collector to cut too few hawids and he finds out at the desk with the card in front of
him.

### The gestures, and which of them takes a position

Marking printed is a **deliberate act**; generating a PDF marks nothing. It takes positions in the
listing on screen plus `albumPlanFingerprint` of that listing, and is refused against a plan that has
moved — which is what keeps a position meaningful only against the plan that produced it.
**Reprinting takes the card's own id**, never a position; ADR-0046 §7 says why, and it is the trap
this issue was warned about.

The fingerprint covers **composition only** — the sheets, their order, and whose stamps are on each.
Not the texts, the geometry or the range: none of those changes *which card a position names*, and a
refusal the collector cannot account for is one they learn to click through.

A block's sheets go onto paper **whole or not at all**. The listing carries `runWith` so the
collector is told which sheets go together up front, and the refusal names the ones **missing from
the selection** rather than the run alone — it is not a normalisation waiting to happen, so it has to
hand back something actionable.

### `album-printed-pages.ts` reads; `album-printing.ts` writes

They are two modules on purpose. The planner reads the index, and the writer plans; one module for
both would be a cycle between two `src/lib` modules — the kind that passes every test and throws at
module initialisation in the real app (`docs/agents/platform.md`).

### The divergence report is per card, not per album

`getAlbumPrintedReport` re-plans **each printed card's own entries on fresh paper**, through the same
`albumPlanContext` the live plan uses, and diffs that against the snapshots with the pure
`album-divergence.ts`.

The obvious reading of ADR-0045 §3 — re-plan the whole album as if nothing were printed — **cascades**:
one stamp joining an early checklist re-flows every later sheet, and the report then names a dozen
cards for one acquisition. That is the failure the issue exists to prevent, arriving by a different
door. Per-card is also what the planner actually does: a printed sheet is a page boundary and the
plan resumes on fresh paper after it, so a card's content never re-flows across its edge.

Three things the reference has to get right, each of which is a measurement against the correct
reference where the wrong one is the common case:

- it **excludes stamps on other printed cards**, or a card would report its own continuation as
  missing from it, for ever;
- it **excludes stamps waiting on an open continuation**, because that divergence is answered;
- it carries the **chapter heading iff the card carried one**, or every chapter's first card would
  report its own year as newly arrived.

Cards are grouped by **a block that spans sheets**, not by a checklist two sheets share — the
difference *is* the continuation page. The signal is the snapshot's own block `part` (1, 2, 3 for a
split; back to 1 for a continuation), not the index's `part` column, which is offset so an entry's
cards stay in filing order.

The kinds are ranked `stamps`, `size`, `text`, `template`, `photo`, and **`photo` is last on
purpose**: a picture arriving after a card was printed is real and low-value, and one bulk scanning
session would otherwise bury every genuine finding. The comparison is over **facts, not
coordinates**, and the footer is suppressed when the stamps are what changed — it names the range, so
it changes by arithmetic.

### What a card may carry

Only what stays true of the **objects** it describes. Nothing that is a function of what the collector
owns — a completion count, a valuation, an owned/wanted marker — because every acquisition would then
register as a divergence on every page carrying it.

The distinction is *printed onto the card*, not *shown about the card*, and it is as easy to misapply
in the other direction: the inherited-size and oversize flags on the album screen and in #769's editor
have the same staleness property and are shown deliberately, because they are shown on screen before
printing and never reach the paper.

### The two answers, and the third act that is not one

- **A continuation page** — `AlbumEntry.continuesPrintedPageId`. Its stamps are *derived* (the entry's
  stamps on no sheet yet), not frozen, so a second arrival before printing lands on the continuation
  still on screen. Cleared when the continuation is itself marked printed: the choice is per
  divergence, not a setting.
- **A reprint** — `reprintingAt`. The card leaves the printed index and re-plans in full; the row
  survives to say a superseded card is still in the binder, and is discarded only when every **stamp**
  it holds is on a card not itself awaiting one — which is what makes it work when the replacement
  comes out as two sheets. A reprint nobody finishes stays that way **indefinitely and without
  nagging**. An open continuation on the card **folds away with it** by construction (the entry plans
  live and whole, and a continuation block is only emitted for an entry with something on paper); the
  flag is left standing so that cancelling restores exactly what was there.
- **Un-printing** is neither, and is loud: it throws the stored result away and says first what will
  change, from the server's account of *that* card.

### What building this turned up in the layout

Both reachable only once a sheet could actually be printed, and both now pinned in
`tests/unit/album-layout.test.ts`:

- **A sheet is filed exactly once**, where its first block puts it. Reordering entries after printing
  separates a sheet's blocks, and #767 then emitted that card twice — listed twice, drawn twice,
  reprinted twice. There is no arrangement that makes a reordered printed sheet read correctly; there
  is one that keeps it a single card.
- **A chapter whose first block is on paper does not print its year again.** The card carries it.
  Otherwise an album with every chapter printed is a run of blank sheets each headed with a year.
  (Not the same case as #768's year heading legitimately alone on a sheet — there the content under it
  moved to the next *live* page.)

## Configuration is seeded, never referenced

Choosing a template on an album copies its values onto the album (#308's rule, #766). It matters
more here than anywhere: editing a template must not reach back into a page that is already in the
binder. The hawid stock is the deliberate exception and is read live — it is a statement about a
drawer, and a drawer changes; what must not change under a printed page is the album's own frozen
plan (#767).
