# Albums

Printed album pages: what a page is, and what its boxes are cut from. The design was decided in
**#755** — read that issue before anything here, it is the reasoning this file only summarises — and
is being built out in #763–#771 and #777/#778. The model itself is **ADR-0045** (#767); printed
pages are **ADR-0047** (#778); the cutting list they all feed is #770, below.

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

**#769 counted again and it moved two decisions.** Over his own six areas
(`DA DE-BM DE-BY DR PL "PL-ON GG"`, excluding `examples/`):

- **`PAGE_VSPACE` — 480**, over **198** `PAGE_START(` pages. Extra vertical space is by a long way
  the hand correction he actually makes, about 2.4 a page, which is why it is the first of #769's
  five and the one with real rails around it. Values cluster on multiples of five.
- **All 18 negative `PAGE_VSPACE` are in the six `_*.txt` running-head includes** — `-6`, a white
  spacer image, `-18.5`, then `PAGE_TEXT_CENTRE(HEADER 18 …)`: the head construction `printTitle`
  already models. **Not one is in page content.** So a space correction may be negative but the
  layout floors a block's lead at zero: closing a gap is something he does, overlapping two blocks
  is not.
- **`PAGE_TEXT_PARAGRAPH_START` — 0**, and **`PAGE_TEXT(` — 0**. All 21 paragraph blocks in the
  corpus are in AlbumEasy's own `examples/`. The **free text block is an invention**, and both
  `album-corrections.ts` and the migration say so where somebody would otherwise assume it was
  measured like everything else here.
- **`PAGE_BREAK` — 0.** AlbumEasy paginates by hand, so his 198 `PAGE_START(` *are* the breaks. The
  forced break and the forced no-break have no corpus either.

One thing the count turned up that #769 did **not** build, recorded so the next person does not have
to find it again: several of those `PAGE_VSPACE` sit **between a heading and its boxes**, inside a
`PAGE_COLUMN_START` pair — `PAGE_VSPACE(9.0)` after a heading that wrapped to two lines, lining its
mounts up with the one-line heading beside it. That is a third space correction, and #769's issue
lists only *before* and *after* a block, so it was left out deliberately rather than missed.

Note that the defaults in `DEFAULT_ALBUM_PRESET` (#766) and the packing rules in `album-layout.ts`
(#767) are all measured from these files, and each says which line it came from. Anything added later
should be able to do the same, or should say plainly that it is an invention.

## Hawid stock and the box rule (#765, corrected by #793)

`HawidStrip` is a collection-level dictionary — two heights, the stock length a strip is sold at, an
optional label, a drag order — shaped and placed like `StampFormat`, edited in **Settings → Albums**.
Nothing is seeded and nothing is backfilled.

**A strip is named after the stamp it takes, so it carries two heights, and confusing them is what
#793 was.** `heightMm` is the number printed on the packet: a `26 mm` packet accepts a 26 mm stamp
and is itself about 30 mm tall, because the welded border is part of the product. `totalHeightMm` is
that outer height — what a ruler laid against the strip reads. The field is stored rather than the
border because the total is the figure a collector can establish without inferring anything; the
border is derived (`hawidStripBorderMm`) and both are shown on the row.

Reading one number as both got both jobs wrong at once. A 26 mm stamp with 4 mm of clearance demanded
a *label* of 30 and so skipped the packet it belongs in, and the box was then drawn 4 mm shorter than
the mount about to be glued down — the page-disagrees-with-the-desk failure this rule exists to
prevent, arrived at from the inside.

**A total of 0 means "not measured yet",** which is what the migration left every existing row at.
The border differs by product and cannot be derived, so `hawidStripTotalHeightMm` falls back to the
packet number: the arithmetic that ran before #793, unchanged, until the collector types a figure.
Guessing it would invent the one number the module exists to keep honest, so the dictionary says
`outer height not measured` on the row instead.

`src/lib/hawid.ts` is the rule, and it is **pure**: no Prisma, no rendering. Four surfaces will draw
from it — the page plan (#767), the PDF (#768), the editor canvas (#769) and the cutting list (#770)
— and the only way four surfaces agree on a millimetre is that none of them does the arithmetic.
`src/lib/hawid-stock.ts` is the Prisma side and the rule knows nothing about it.

What the rule says, and why each half is the way it is:

- **Height comes out of the drawer, and it is the strip's own height.** The stamp plus the
  template's vertical clearance must fit inside a strip's **total** height; the shortest strip in
  stock that takes it wins, and the box is drawn **at that total** — that is the piece of hawid that
  ends up on the card. Not the stamp's height plus a margin, and not the packet number: hawid is sold
  as strips of a fixed height that are cut across, so a box drawn at a height no strip has is a page
  that disagrees with the piece on the desk. Short means the outer height too, since that is the
  material being spent; ties go to the earlier strip in the collector's order, so two callers cannot
  resolve one stamp two ways.
- **The template's vertical clearance is not redundant and is not the strip's border.** It is how
  much room the collector wants around the stamp, and it keeps working the way it reads: raise it to
  8 mm and a 26 mm stamp moves off the 26 mm packet (30 mm of strip) onto the 30 mm one (34 mm),
  which is a deliberately roomier mount rather than an accident of arithmetic.
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

**Printed pages laid out before #793 will diverge, and that is correct.** A snapshot (#778) froze the
heights it was printed with, so a live page now reports `boxes would now be cut to a different size`
against it. Those pages *were* laid out on the wrong figure; the report's existing wording covers the
cause without change, and nothing about a printed sheet is rewritten.

## The album template (#766)

`AlbumTemplate` is a collection-level **render preset** — page, spacing, hawid clearances, a face and
size per type role, box treatment, photos, and four texts — edited in **Settings → Albums** beside
the stock. It is `CollageTemplate`'s analogue and follows #307/#308's decisions rather than parallel
ones.

`src/lib/album-template-rules.ts` is the pure half: bounds, parsing, `AlbumRenderPreset` — the type
an `AlbumTemplate` is *plus an id and a name* — and `renderAlbumText`, which is where a blank
template renders blank rather than falling back to a generated listing title. That last one sits here
rather than in the plan because the plan is not its only caller: the template's own preview (#795)
renders the same four texts before any album exists, and the blank-template guard is exactly the sort
of half that gets left out of a second renderer. #767's `Album` embeds the same preset, and that
shared type is the only thing keeping the two field lists in step.

**It stays a shared type — never a shared row, never a foreign key.** The duplicated columns are the
design, not an oversight waiting to be normalised: choosing a template copies it, so editing one
cannot reach into a page already in a binder. That is #308's rule, and paper is why it is stricter
here.

The defaults are **measured, not invented**: `DEFAULT_ALBUM_PRESET` is the geometry of the
collector's own AlbumEasy sources — A4, 10 mm margins, `ALBUM_PAGES_SPACING (1.0 6.0)`, and
`STAMP_BOXES_SIZE_ADJUST(4)` split across the two clearances that single global figure becomes.

### The preview beside the fields (#795)

Thirty-odd numbers, none of which showed what it did until an album was generated and a PDF produced
— *"the flow of setting up a page template is practically impossible to get through"*. The preview
**adds no capability**; it makes an existing one usable, and that is the whole measure of it: can he
change a number and see it.

`album-preview-sample.ts` is the sample and is pure; `album-preview.ts` is the server side;
`album-template-preview.tsx` is the panel. What is worth not re-deriving:

- **It draws through `AlbumPageCanvas` and plans through `planAlbumPages`**, and every millimetre on
  it comes from one of the two. This is `hawid.ts`'s rule at its sharpest — four surfaces agree on a
  millimetre only because none of them does its own arithmetic — and here it is sharper still,
  because the collector is about to change a number *because of* what this sheet shows him. **A
  preview that disagreed with the PDF would be worse than no preview: it would be a confident wrong
  answer.**
- **The canvas grew a second shape rather than a set of no-op handlers.** `AlbumPageCanvasStatic`
  (`interactive: false`) has none of the six callbacks and draws no grab cursors, no drop marks and
  no handles. A canvas handed six functions that do nothing still *promises* what a gesture will do,
  on a surface where nothing happens — and the editor's own props stay required, so a forgotten
  handler there is still a type error.
- **`liveSheet` takes `AlbumSheetSource`, a four-member subset of `AlbumPlanContext`.** The editor
  passes a whole context; the preview has a preset, fabricated entries and no row anywhere. Stating
  what a sheet is actually built from beat implementing three resolvers nothing would ever call — a
  half-implemented interface reads as *this cannot be asked* where the truth is *nothing asks*.
- **The sample stops at `planAlbumPages`; a real album goes through `planAlbumFrom`.** Not a
  difference in geometry: what `planAlbumFrom` adds is notes, corrections and stepping over printed
  cards, and a preset has none of the three. It also buys the thing that makes the sample checkable —
  `planAlbumFrom` is unreachable from `test:unit` (Prisma), so a sample that needed it would have had
  its two-page claim pinned against a *second* reference that agrees with the app today. That is the
  measurement-against-the-wrong-reference family this file already carries three examples of.
- **The sample states its own chapters** rather than being grouped by year at runtime. It is fixed
  data; grouping it again would be a second answer to a question that has none.
- **Every figure in the sample was counted, and this file is why.** It is the one part of #795 that
  would otherwise have been entirely invented, so it is not: all eighteen stamps are the collector's
  own, at the sizes he measured, under the headings he wrote, cited line by line from `PL-1950.txt`
  and `PL-1951.txt`. The second sheet reproduces one of his printed pages — `1951, 15 XI` puts the
  two Festiwal Muzyki Polskiej stamps and the Zjazd PZF block on one card, which is where they are in
  his binder. *Eight definitives fill a row* is then a claim about real Liberation advances at a real
  mount size on real A4, which is the only version of that claim worth making.
- **They were chosen for six properties, and the unit suite pins each one rather than a snapshot**:
  four mount heights (23/26/32/45 — a page of one size selects one strip and says nothing about the
  vertical clearance), a souvenir sheet no strip fits, a run of eight that fills a row and starts a
  second, two pairs of short checklists that band at a ceiling of two and stack at one, a heading
  long enough to wrap inside a band, and two chapters — which is how it is two sheets without any
  pagination being built for it. Measured with the **shipped** measurer, not the layout suite's
  arithmetic stand-in.
- **The souvenir sheet closes the second chapter, and that is arithmetic.** In 1950 it spilled the
  sample onto a third page and left the whole of 1951 unseen behind a preview that draws two.
- **The sample states every size and carries no corrections**, so no box is inherited, unmeasured or
  hand-corrected. Those flags are facts about a collection's data (#763) or one collector's page
  (#769), and a *template* preview showing one would report a problem nobody can fix from that
  dialog. On a real album they are real and are shown.
- **`albumPlanContext` takes a preset override**, which is the whole of the real-album path: the
  album is re-planned in memory under the dialog's preset. It is substituted before anything is
  resolved, because the clearances are read once into `margins` — swapping the preset afterwards
  gives the new faces with the old box heights.
- **Redraws as you type, and that was measured before it was promised.** Planning the sample — 18
  boxes through the hawid rule, four texts rendered, the page packed against real advances — is
  **1.2 ms** warm and about 30 ms on the first call while fontkit parses a face. The cost of a
  keystroke is the round trip, not the planning, so the request is debounced (260 ms) rather than the
  redraw made explicit.
- **It goes through the same parser a save goes through**, so it can never draw a page the template
  would refuse to store. The name is the one field it stands in for: a template being written has no
  name yet, and the running head prints the **album's** name anyway — the same stand-in
  `ALBUM_PREVIEW_CONTEXT` already gives the four text builders.
- **Beside the fields, not behind a tab**, and the dialog is 76 rem for it — wider than anything else
  in the application, for #815's reason: the right-hand column is a piece of A4. A preview behind a
  tab is one nobody looks at *while typing*, which is the only moment it is worth anything. The
  fields keep the ~800 px they had at 52 rem.
- **The fields stay uncontrolled.** The preview reads the same `FormData` the save reads, so there is
  no second copy of the preset that could disagree with what a save would store. The dialog only
  counts changes — from the fields' own `onChange` *and* from the four text builders, which are React
  state written into hidden inputs and fire no `input` event of their own.

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

### The album's name is suggested from its area, and the suggestion declines the roll-up (#797)

`suggestAlbumName` (`src/lib/album-name.ts`) offers the create dialog a name built from the chosen
area and the album's language. Two decisions in it are worth more than the six lines of code:

- **It reads the area's *own* name — `areaOwnTitleName`, not `buildAreaTitleMap`.** The map rolls a
  blank-`titleName` area up to a public parent, which is what an auto-generated listing title wants:
  a grouping level is deliberately invisible to a buyer. An album is the other case. The collector
  *picked* that area, so naming their binder after a parent they did not choose is a substitution,
  not a fallback — and it prints at the top of every page. Both readings live in `area-vendor.ts`
  over one shared per-node resolver (`statedTitleName`), so they cannot drift apart on the language
  fallback while disagreeing on the walk, which is the only thing they are meant to disagree about.
  The `{area}` **token** in an album's printed texts still rolls up (`title-copy.ts`), and that is
  consistent: the token is a label about the stamps on a page, not the name of the thing chosen.
- **The language chooses the spelling; it is never appended.** No `(polski)` on a running head. Where
  a translation exists the language is already what the name *says*, and where none does an appended
  tag would decorate a name that had not changed. The cost is that two albums on one untranslated
  area in two languages are suggested one string and the second is refused by
  `@@unique([collectionId, name])` — a clear refusal in that one case, against a parenthesis on
  everybody's pages.

The suggestion is **derived, not synced**: `AlbumForm` renders the suggestion until the collector
types and their own text afterwards, with no effect writing into the input. That is what makes "a
typed name is never overwritten" unreachable rather than merely unlikely — an effect keyed on the
area would have to be *argued* not to fire. #797 also lifted the whole form to controlled for this;
the posted field names stayed `name`, `collectionAreaId`, `language`, `templateId`, so
`actions/albums.ts` never learned about any of it.

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

## The page editor (#769)

Where the collector overrules the layout. `album-corrections.ts` is the pure vocabulary and the one
piece of arithmetic; `album-editor.ts` builds the sheet a canvas draws; `page-canvas.tsx` draws it and
`page-editor.tsx` is the screen. The corrections themselves are three columns on `album_entry`, an
`album_box_adjustment` row per box and an `album_text_block` row per note
(`20260906170000_album_corrections`).

**Every correction is a delta, and that is not a style.** ADR-0045 §3 is the reason: a live page has
no row, and its identity is derived from its own contents, so anything keyed on a position would be
undone by the next stamp bought. A delta hangs on an entry, a block or a stamp — all three are rows —
and the automatic layout goes on running underneath it, which is what makes a correction survive a
re-flow. There is deliberately **no save-the-page action anywhere**, because there is no page to save.

Six things worth not re-deriving:

- **A box correction is millimetres on the *stamp*, applied before `hawid.ts` runs**, never on the
  box the rule produced. A hawid box's height is the height of the shortest strip in the drawer the
  piece fits into; correcting the finished box would draw one at a height no strip has, which is
  exactly the failure #765 exists to prevent. So the height moves in **strip steps** and the width,
  which is the cut, moves continuously — and raising past the tallest strip, or widening past a
  strip's stock length, makes the box a pocket. The screen says so, because a drag that asked for
  2 mm and got 5 looks like a bug otherwise. Pinned in `tests/unit/album-corrections.test.ts`.
- **The key is `(albumEntryId, stampId)`, because a box is a slot and not a stamp** (ADR-0047 §2). A
  stamp can be on two checklists of one issue, and an album gathers both, so keying on the album and
  the stamp would let one correction silently move two boxes.
- **`avoid` is a preference and `always` is not.** A forced break is something the packer can always
  honour; *keep with the block above* is honoured by making the unit that moves whole bigger
  (`keepTogether`), and a run of them taller than a sheet has no arrangement that satisfies it — so
  the packer **drops** the preference rather than looking for one. That is also why `avoid` needed a
  look-ahead at all: this packer never goes back for what it has already placed. **A dropped
  preference is reported**, on the block and on the sheet: a constraint dropped silently is one the
  collector finds out about with the card in his hand, which is the same argument the inherited-size
  and oversize flags are shown under. `AlbumPlacedBlock.separated` is read off the **page** — a block
  that got what it asked for has the block it wanted above it, so the sheet is not empty under it —
  rather than off the packer's branches, so every way the preference can be dropped arrives the same
  way. A continuation sheet of a split block is excluded: nothing was separated that anybody asked to
  keep together.
- **`breakInside: avoid` — *keep this checklist whole on one card* — is deliberately not built.** It
  is a different control rather than a narrower reading of the pair above, the issue does not ask for
  it, and #768 already made a split block legible with the `[2]` marks. If it is wanted it will be
  asked for after a split series comes off a printer, which is the right moment to design it.
- **A note is anchored to an entry, not positioned among them, and the anchor carries a side.**
  *After X* and *before Y* are one gap today and two different ones the moment the album is
  reordered, and a note that **opens a chapter** is the case that separates them: written as *after
  1949's last checklist* it slides into the middle of 1949 the first time a gathered checklist is
  dragged in there. Null + `before` is the head of the album, null + `after` is the end of it, and
  both are steadier than naming the first or last checklist. `SET NULL` is what a removed anchor
  does — a note that jumps to the head is loud and one drag from being right, where a note deleted
  with its anchor is the collector's own words gone. (The side arrived one migration later,
  `20260906180000_album_text_block_side`, which also renamed the column rather than leaving a name
  that lies half the time.)
- **The gesture reads as a sequence; the model stays an anchor.** Dropping a note's heading on a
  block files it *before that block*, which is what a collector expects from dragging — and it is
  also what makes the note travel when that block is later dragged somewhere else, which a position
  in a shared ordering space would not.
- **A note on a card may be edited and may not be deleted**, and the asymmetry is the point rather
  than an oversight. Editing is the same shape as renaming an issue: the snapshot cannot change, the
  live row goes on being live, and #778 reports the difference (`album-divergence.ts` names it *a
  note* rather than *a checklist heading*, which needed `kind` on the comparable block). Deleting
  would take the card's own account of the note away with it, and `diffAlbumPlanPages` now reports
  a note on a card that the album no longer has — the one thing that could otherwise vanish into
  silence, since a note carries no stamps for the stamp rules to catch.
- **The chapter's opener is not always `blocks[0]`.** A live note filed at the head of the album sits
  in front of a printed first block and was on no card, so reading it as the opener would print the
  year a second time on a live sheet in front of the card that carries it — ADR-0047 §4's family
  arriving through the editor. `planAlbumPages` skips live text blocks for that one question.
- **A note names its own sheet** (`album_text_block.printedPageId`), the same seam
  `AlbumEntry.continuesPrintedPageId` is, and the *index* answers which sheet that is
  (`AlbumPrintedIndex.byTextBlock`) so a reprint brings the note back with the checklist beside it.
  Two smaller consequences fall out and are easy to lose: a sheet carrying nothing but a note has no
  stamp rows, so it would read as **orphaned** without being claimed in the index, and it joins no
  card group in the divergence report without `printedCardGroups` being told about it. Both are
  handled; a third of the same shape is what to look for next.

**A reorder is carried in state and drawn; the mark and the drop read one function** (#816). The
three millimetre gestures ride in `CanvasDrag` and the canvas draws them, but reordering was held in
a `useRef` — which by design does not re-render, so between press and release nothing knew a drag was
happening and nothing could be drawn. It is `useState` now, and deliberately **not** folded into
`CanvasDrag`: that shape is millimetres already moved, it has a second writer (a figure typed in the
panel), and it is read on release to commit a number, none of which a reorder has. What the mark
means is `src/lib/album-drag.ts`, pure and unit-tested, and it is the **same** `insertBefore` the
screen writes the order with — a mark under the pointer is a promise about what the drop will do, and
the only way that promise stays true is for the drawing and the writing to read one function. Three
things fall out of it and are the whole of the visual language: **insert-before, never swap**, so the
mark is a bar in the gap in front of the target rather than a second highlighted box (two boxes lit as
if they exchanged places would teach a rule the app does not follow, and the collector would predict
the wrong result every time and be right about the picture); **a note is filed, not positioned**, so
carrying one shades the block it would be filed against instead of drawing it a slot in a sequence it
is not in — deliberately the *less* specific mark, since a note dropped on one filed elsewhere joins
that anchor without promising a place among its new siblings; and **no mark means nothing happens**,
which is what a box carried over another block's boxes and a checklist carried onto a note both get.
The canvas also sets `user-select: none` **always** rather than only while carrying: it is a drawing
surface and not a document — a press-and-move over it selected the catalog numbers under the boxes —
every word on it exists as a row elsewhere, and a rule that only holds during a gesture is one more
thing to keep in step.

**The client does not measure.** `album-editor.ts` ships the *results* of measuring — the wrapped
lines, each run's band, its line height and its `albumBaselineOffsetMm` — and the canvas positions
what the renderer positioned. The one thing that is genuinely the browser's is centring an
already-wrapped line with `text-anchor="middle"`, which is a **paint** difference: `cssStack` names
the metric twin of each embedded face first, and nothing about where a block breaks depends on it.
Dragging is a geometric offset and typing feeds the same offset; both commit server-side, which
re-plans.

The sheet is drawn in **literal ink and paper** rather than semantic tokens, and the box flags with
it. That is `ui-patterns.md`'s stated exception — the reading label on a scan (#598) — for the same
reason: everything inside the frame has to stay legible over white paper and printed ink in either
theme, and a token that inverts would make dark mode mean a black album page. Everything outside the
frame is tokens.

**The screen is a workbench and takes the window** (#815). It shipped inside a `maxWidth: 84rem` with
its three columns each capped at `maxHeight: 42rem` — the only such width cap in the application, on
the one screen whose whole subject is looking at a sheet of paper at 1:1, and three constants that
had to be kept in step to stay level. Both are gone. The root is the shape every other screen here
has (`padding: 2rem`) turned into a **column**, and the card takes what the heading leaves —
`flex: 1` with a floor, which is the lot builder's spelling (`offers/lot-builder`), the app's other
three-region screen. **The columns then have no height of their own**: stretched to one card, they
cannot disagree about how tall they are, and each scrolls its own contents — the sheet list, the
canvas (297 mm of paper never fits a window) and the inspector. What is deliberately kept is the
`48rem` **measure on the explanatory paragraph**: a line length limit on prose is a different job
from a cap on a layout, and sweeping it away with the cap would be the same mistake in the other
direction. The 13rem and 20rem side columns are column widths, likewise kept.

**`height: 100vh`, not `minHeight` — and the floor was never the thing that made the page scroll.**
The first cut of the above wrote `minHeight: 100vh`, the shape every other screen here has, and
reported the floor as the deliberate degradation for a short window. On this screen that produced the
opposite of a workbench: the whole page scrolled and the sheet list and the inspector went with it,
which is the amendment the user filed against #815 after looking at it. **A floor leaves the column's
height indefinite, and `flex: 1` in an indefinite column has no space to distribute** — so the card
sized to its own content instead, and its content is a sheet of A4 at 1:1, 1122 px. The `24rem` floor
had nothing to do with it and could not have: it only bites below a window of about 580 px, and the
card was three times that. **The lesson generalises past this screen: `minHeight: 100vh` and
`height: 100vh` are not a strict/lenient pair. One of them hands a flex child a share of the window
and the other hands it nothing**, and the difference is invisible until a child is taller than the
window — which on every other screen here it is not, and on this one it always is. The floor stays,
lowered to `18rem` so the exception is rarer still (below roughly 480 px of window), and the overflow
now goes to `overflow: auto` **on the screen's own column** rather than to the document: the app
sidebar stays put, and the browser never grows a second scrollbar beside the canvas's own.

**The canvas viewport centres `safe`ly** (#820). It is a centred flex container that also scrolls,
and that pair is a trap: a sheet wider than the viewport — a narrow window at 150% or 200% — is
pushed out on *both* sides, and only the right side can be reached, because a scroll container will
not scroll to a negative position. The left edge of the page was simply unreachable. `justify-content:
safe center` falls back to start alignment exactly when centring would overflow and leaves a sheet
that fits centred, so it costs nothing in the ordinary case. It is the only scroll container in the
application that centres its content on the overflowing axis; there is nothing else to fix here, but
it is the shape to recognise if another screen ever grows one.

## The cutting list (#770)

What the collector cuts for a card, and what the album still needs bought. `album-cutting-list.ts`
is pure and does **no box arithmetic** — every width and strip height arrives already decided, by
`hawid.ts` for a live sheet and from the snapshot for a printed one — so what is in there is
counting, grouping and packing. `album-cutting.ts` is the Prisma side and does one thing beyond
reading rows: a snapshot calls the strip's stock length `lengthMm`, and that field name is the only
adaptation in the file.

It prints through the browser (`@media print`, `globals.css`), like the packing list (#643) and the
sorting slips (#565). ADR-0046's argument for a server-composed PDF is about a card whose boxes get
cut to; nobody measures a list.

Four things decided here that are worth not re-deriving:

- **The strip count is packed, not divided.** `packStrips` is first-fit-decreasing over the pieces.
  Total width over stock length under-counts — a piece cannot span two strips, so four 120 mm pieces
  need four 210 mm strips and not the three `ceil(480/210)` gives — and under-counting is the one
  direction a shopping list must never be wrong in.
- **An unmeasured box is uncuttable and does not reach the cuts.** This is the trap. A stamp nothing
  on its checklist has measured gets a *degenerate* box — the clearances and nothing else — and a
  degenerate box is **small**, so the rule finds it the shortest strip in the drawer. Read as an
  ordinary cut it is a plausible instruction to take 2 mm off the 21 mm strip. It goes in the
  no-hawid section beside the oversize pieces, for a different stated reason.
- **The demand is two figures, never summed, printed cards first.** *Marking printed* and *mounting*
  are two moments and the collector marks a sheet **as it leaves the printer** — asked and answered —
  so a card being on paper says nothing about whether its hawid has been cut. Neither single total is
  the answer: one over everything counts material mounted a year ago, one over the live sheets alone
  leaves out the run he is about to sit down with. Each printed sheet therefore carries the minute it
  went onto paper, which is as far as the model honestly goes — **the album records printing, not
  mounting**, and a rule deciding *these are mounted and those are not* would be the app inventing a
  fact it does not hold. Do not "simplify" this into one number; the two-figure shape is the finding.
- **A printed card's strip is flagged, never remapped.** A copied strip (ADR-0047 §1) can name a
  height the drawer no longer holds. The row still states what was cut — nothing reaches backwards
  into a card already made — and carries `inStock: false`, so a line the collector cannot act on says
  so. Substituting today's nearest height would be the list inventing a cut nobody made.
- **The per-sheet lists and the album demand are allowed to disagree**, and this is stated in the
  module because it looks like a bug and somebody will try to fix it: summing every sheet's cuts does
  not give the shopping list. A sheet's list is a *record for one card*; the album demand is about
  *work left*, so printed cards sit in a figure of their own. Reconciling them means either dropping
  printed cards from their own cutting lists — the one thing the snapshot keeps `sizeSource` and the
  copied strip for — or counting a card's hawid into a shopping list twice.
- **A printed card whose snapshot cannot be read is named, not dropped.** Nothing may re-derive its
  boxes from live data (ADR-0047 §1), so the honest answer is a sheet with no cuts and a sentence
  saying why. A card listed as needing nothing is worse, because only one of the two gets looked at.

It has its own route rather than a section of the album screen, and the reason is not that the album
screen prints badly: the cutting list is a **working document read at a different moment and in a
different place** — at the desk, with scissors, away from the surface where entries are dragged
around. Same reason a packing list hangs off a sale rather than living on it. And it carries **no
toggles or filters**, like every other print sheet here: paper cannot say which state a control was
in when it was printed, so both demand figures are always on the page.

The mapping from a plan page to a cutting sheet is in the **pure** module (`albumCutSheets`) rather
than in the Prisma one, and deliberately: it is where *stepping over printed sheets* is answered, and
that answer has to be reachable from a test that constructs an album with every page printed and one
whose entries were reordered after printing. Both are in `tests/unit/album-cutting-list.test.ts`,
built on `planAlbumPages` with stand-in snapshots, and neither is reachable through Prisma in a unit
test. The list reads the plan's own sequence and never rebuilds one from the printed index, which is
what keeps a reordered printed card one card.

## Configuration is seeded, never referenced

Choosing a template on an album copies its values onto the album (#308's rule, #766). It matters
more here than anywhere: editing a template must not reach back into a page that is already in the
binder. The hawid stock is the deliberate exception and is read live — it is a statement about a
drawer, and a drawer changes; what must not change under a printed page is the album's own frozen
plan (#767).
