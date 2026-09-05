# Albums

Printed album pages: what a page is, and what its boxes are cut from. The design was decided in
**#755** — read that issue before anything here, it is the reasoning this file only summarises — and
is being built out in #763–#771 and #777/#778. The model itself is **ADR-0045** (#767).

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
Times New Roman and Arial roughly 200 already-printed pages are set in, and Noto. #768 embeds the
bytes and owns verifying coverage.

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
- **There is no live-page table**, and **no plan-to-plan comparison anywhere in #767.** `planAlbum`
  runs on read; only #778's printed page is ever a row. A live page reshuffling harms nothing — that
  is what makes it live — so the only comparison with a customer is the live plan against the printed
  snapshots, and #778 owns it whole. (An early draft of #767 asked for a refresh report; the bullet
  was rewritten, the screen has none, and a diff written here was removed rather than shipped ahead
  of the spec that will shape it. ADR-0045 keeps the two non-obvious parts of that design — pair by
  contents, never by name; a page that only moved is not a change.)
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

The table there is **provisional** — the real advances belong to the faces #768 embeds, and there are
no font bytes in the repo yet. It is safe only because nothing can be printed before #768 exists, so
every plan it has produced is live and re-flows. It is checked against ground truth: the three
headings the collector left on one line measure inside his 190 mm content width, and the one he broke
by hand with a literal `\n` measures 203.

### A page range is written out in full

`PL 303-309`, not `PL 303-09`. The one place the app does not apply `formatCatalogRange`'s
shortening (#400), and #767 does name that module for this — the deviation is deliberate and decided
with the collector: the range is printed onto a card filed beside 140 that write the span out.
The **separator stays the app's hyphen**, though: his own sources use an en dash in
`PAGE_START(303–309)` and that was put to him too — one mark across the footer, offer titles and lot
names beat matching a dash at 8 pt. Only the shortening is the album's own. Both were asked and
answered; neither is an oversight to fix.

### The seam #778 picks up

A block already on a printed sheet names it in `AlbumBlockSpec.printedPageId`, and the planner steps
over it whole. Two consequences are deliberate: a stamp on a printed page is not in the live plan at
all, and a stamp that **joins** a checklist whose page is printed appears **nowhere** rather than
being appended to the next live page. That silence is the state #778's continuation page answers, and
inventing a home for the stamp would hide the thing the collector needs to be told.

### Two sharp edges worth knowing

- A chapter is **grouped** by `Issue.year` but its default heading is `{year}`, which resolves from
  the **stamp's** own `issuedYear` (#766 chose that token). They agree on ordinary data and can
  disagree on odd data; `{issueYear}` is available if that ever bites.
- Chapters are **runs** of consecutive entries sharing a year, not year buckets. Reordering entries
  so years interleave produces two chapters headed 1938 rather than silently pulling them back
  together: a layout that re-sorts what the collector arranged is one they cannot predict, and this
  one is printed.

## Configuration is seeded, never referenced

Choosing a template on an album copies its values onto the album (#308's rule, #766). It matters
more here than anywhere: editing a template must not reach back into a page that is already in the
binder. The hawid stock is the deliberate exception and is read live — it is a statement about a
drawer, and a drawer changes; what must not change under a printed page is the album's own frozen
plan (#767).
