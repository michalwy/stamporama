# Detail pages

Three records have a **screen of their own**: a **copy**, a **stamp**, and an **issue**. Each one
gathers in a single page everything the app knows about that record — the fields, the photos, the
catalog prices, and the other records that point at it.

Each page is laid out in **two columns** of cards, using the full width of the window — so there is
far less to scroll than a single column would leave. The split is the same everywhere: the **left**
column is what the record *is*, the **right** is what your collection does with it — the copies you
hold, the offers it is on, the purchase and sale behind it. On a narrow window the two run one after
the other, left column first.

A card **only appears when it has something on it**. A copy with no photos has no Photos card, a
stamp on no want list has no Wants card, a stamp nobody has priced has no Catalog prices card. So
what you see on one of these pages is what that record actually has — the page never spends a
heading, and the scrolling under it, on telling you that something is not there.

No field on these pages is typed into directly. Everything is still edited where it always was: the
copy form, the stamp dialog, the issue dialog — and where a page offers a button that starts one of
those, it is that same dialog that opens, so there is never a second version of a record to keep
straight. All three pages carry **Edit** at the end of their identity line, so a mistake you notice
while reading the page is corrected on the spot rather than back on the list you came from. The popups you already use (**View copies**, **View offers**, **Show valuation**) also stay
exactly where they are — they answer one question without leaving the list, and these pages are for
when you want the whole picture instead.

## Opening one

Every row that stands for one of these three records carries a small **arrow** icon, dimmed until
you hover the row — click it to open that record's page. The same entry is the first one in the
row's **⋮** menu:

- **Copies** list → **Open copy page**
- **Stamps** list, and any stamp inside the **Issues** tree → **Open stamp page**
- **Issues** list → **Open issue page**

The arrow is on the rows **inside** these pages too — the stamps of an issue, a stamp's variants
and its issues, the copies listed on either — so stepping from record to record never needs the
lists in between.

Each page carries a back link to the list it came from. The three pages also link to each other: a
copy links to its stamp, a stamp links to its issues and its variants, an issue links to every
stamp in it.

## Opening things in a new tab

Anything in the app that goes somewhere is a **real link**, so your browser's own habits work on it:
**cmd/ctrl+click** or the **middle mouse button** opens it in a new tab, and **right-clicking** it
offers *Open link in new tab*, *Copy link address* and the rest of that menu.

That covers the arrow icons and the ⋮ entries above, and the list rows themselves — an offer, a
purchase, a sale and an auction sale all open from anywhere on the row, which means anywhere on the
row can be middle-clicked or right-clicked too. The exception is the **chip line** under a row's
name: those chips have hover explanations and controls of their own, so a plain click there still
opens the row, but the new-tab shortcuts want the row's **name**. On the busy **Auction lots** rows,
where the row is a grid of editable figures, use the row's **⋮ → Open sale**, or hold cmd/ctrl while
clicking the row.

The URLs are `/c/[slug]/inventory/[copyId]`, `/c/[slug]/stamps/[stampId]` and
`/c/[slug]/issues/[issueId]`, so a page can be bookmarked or kept open in a second tab.

## Getting back to one

Every one of these pages — and the offer, purchase, sale and auction sale screens with them — is
remembered as you visit it. Click into the sidebar's **Jump to…** box (or press **⌘K**) and the
records you were last on are listed under it; see
[Recently visited](quick-jump.md#recently-visited).

## The copy page

*Left column:* Details, Notes, Photos, Catalog prices. *Right column:* Wants, Purchase, Sale,
Offers. Only Details is always there; the rest appear when the copy has them.

- **Identity** — the internal copy number, the stamp it is a copy of (click through to the stamp
  page), and its catalog numbers. At the end of the line, **Edit** opens the copy form — the same one
  the Copies list opens, over this copy — so a correction noticed while reading the page is made
  here instead of back on the list. A copy whose variant is not identified also carries **Identify
  variant** beside it, opening the same picker the list's row menu does.
- **State chips** — disposition (*In collection*, *For sale*, *For trade*), delivery state, *Sold*
  and any disposal. Your own [tags](tags.md) sit on the identity line above, the same chips the
  Copies list draws; they are changed in the copy form **Edit** opens.
- **Details** — condition, certificate status, physical format, area, issue, storage location and
  in-location ref, cost-basis, catalog value, and the date it was added.
- **Stamps on this piece** — only on a copy carrying more than one: every stamp on it in your own
  order, with each component's format and quantity where they are not the plain default. A **Several
  stamps** chip sits with the state chips, because that is what takes the piece out of every count
  for its stamps. Read-only, like the rest of the page: the list is edited in the copy dialog **Edit**
  opens. See
  [covers and other pieces carrying several stamps](inventory.md#covers-fragments-and-other-pieces-carrying-several-stamps).
- **Photos** — the full gallery, not just the first photo. Click any thumbnail to view it
  full-size. Under the enlarged photo, **Measure and mark** opens it in the same viewer a scan tile
  has — see [Measuring and marking a photo](#measuring-and-marking-a-photo) below.
- **Catalog prices** — the cross-catalog averages for the copy's stamp, with **Full breakdown**
  opening the same per-edition dialog the row menu opens.
- **Notes** — the copy's own text.
- **Wants** — the same card the stamp page carries, for the stamp this is a copy of: every want
  recorded for it, closed ones faded. Each want's **⋮** menu can **Close** it (it is met, and stays
  on the want list as closed) or **Delete** it (permanently, after a confirmation). Its terms are
  still edited on the want list. Not shown on a piece carrying several stamps. See
  [On the stamp's and the copy's own pages](wants.md#on-the-stamps-and-the-copys-own-pages).
- **Purchase** — the purchase order the copy came from, when it came from one.
- **Sale** — when the copy has been sold: the sale, its date and status, the platform, the buyer,
  the line price, the offer it went out through, and whether it has been packed.
- **Offers** — every offer that holds this copy, across all platforms and all states.

## The stamp page

*Left column:* Details, Attributes, Issues, Photos, Copies' photos, Catalog prices, Variants.
*Right column:* Wants, Copies, Offers. Only Details is always there.

- **Identity** — catalog numbers, name, subtype, the Colnect link (or a Colnect search when no
  item-ID is recorded), the copies-held badge — carrying a *(+N)* for the copies held of this
  stamp's variants when there are any, and opening its disposition breakdown on click — and the
  headline catalog price. At the end of the line, **Edit** opens the stamp form — the same one the
  Issues list opens, over this stamp — for its name, issued date, catalog numbers, attributes,
  checklists and [tags](tags.md). The stamp's tags sit on this line as chips.
  (The **Variants** card below edits the stamps *under* this one; this button is for the stamp the
  page is about.)
- **Details** — area, issue date, subtype, and the copies held broken down by disposition, ending
  with the copies held of this stamp's variants when there are any
  ([Copies held](collections.md#copies-held-on-the-catalog-lists)).
- **Attributes** — the six [stamp attributes](collections.md#stamp-attributes): denomination,
  perforation, colour, watermark, paper and printing method, and the stamp's
  [size](collections.md#the-stamps-size) as one figure (`21.5 × 25 mm`). The card appears only when
  the stamp states at least one of them, and then lists them all, so what is *not* recorded is
  visible too. The size shown is the stamp's own — nothing borrowed from a neighbour on its
  checklist. Read-only here, as everything on this page is — the values are edited from **Edit**
  above.
- **Issues** — which issues the stamp belongs to, and which of each issue's
  [checklists](collections.md#checklists) count it. *Optional* means the issue holds it but no set
  counts it.
- **Photos** — the stamp's catalog photos, full gallery. **Measure and mark** under an enlarged
  photo opens the measuring viewer, as on a copy.
- **Copies' photos** — the photos of the copies you hold of this stamp, each titled with the copy it
  belongs to (*Copy 00012 · Front*), so a piece can be measured on the page where the stamp's size
  is set. Only copies still in the collection whose stamp this is — a cover carrying it among
  others is a picture of the cover. At most the first 60 are shown, and the card says so when there
  are more.
- **Catalog prices** — averages inline, full per-edition breakdown behind the button.
- **Variants** — the base stamp this one hangs under, and the variants hanging under it. Each is a
  link to its own page. This is also where a variant tree is **built**: a line at the top says where
  this stamp sits among its siblings (*Variant 2 of 5*) and which issue the card is working in, and
  the card's own controls do the rest.
  - **Add variant** opens the same add-stamp form the Issues list
    opens, with this stamp already set as the parent and its catalog numbers filled in for you to
    suffix (`309` → `309A`). The new variant joins the issue named in the line above.
  - **Add range** adds a whole lettered run at once — `a-f` under `240` is six variants, saved
    together. See [adding a range of variants](collections.md#adding-a-range-of-variants).
  - Each variant's `⋮` menu offers **Edit** — the same stamp form, subtype included — and
    **Delete**. *Open stamp page* and *Edit* are also on the row as hover icons.
  - **Reorder** turns on drag handles so the variants can be put in the order you want them listed,
    exactly as [reordering on the issue's tree](collections.md#putting-the-stamps-in-your-own-order)
    does — it is the same order, so a drag here shows up there.
  - Order is per issue, so the card works in **one** issue: your stamp's first one. A stamp that
    belongs to no issue keeps a read-only card, and when some of the variants belong to a different
    issue the card says so instead of offering a reorder the server would refuse.
- **Copies** — the copies you hold of exactly this stamp (a variant's copies are its own, never
  rolled up into its parent).
- **Wants** — everything recorded on your [want list](wants.md) for this stamp: the acceptance
  chips and the priority, exactly as the want list draws them. Open wants lead; closed ones follow,
  faded — on a single stamp a closed want is the useful record that you were looking for it and
  found it. Each want's **⋮** menu can **Close** or **Delete** it; the form that changes its terms
  lives on the want list. See
  [On the stamp's and the copy's own pages](wants.md#on-the-stamps-and-the-copys-own-pages).
- **Offers** — every offer holding a copy of this stamp.

## Measuring and marking a photo

A stamp you did not measure while identifying it can still be measured from its picture. On the copy
page and the stamp page, open any photo full-size and press **Measure and mark** under it. The photo
opens in the same viewer a [scan tile](purchases.md#measuring-on-the-scan) has: zoom, the **Ruler**,
**Size** and **Perforation** tools, the **Watermark** view, and the
[**Ring**, **Line** and **Snapshot**](purchases.md#marking-a-detail-and-keeping-a-snapshot) buttons.

The rules are the scan's rules:

- **Every figure is shown with the resolution it was taken at**, and that resolution is filled in
  from **Settings → General → Scanner resolution**. If this picture came off a different scanner, or
  was photographed rather than scanned, correct the figure on the measuring bar — it holds while you
  are looking and does not change the collection's setting.
- **The measurement is taken on the picture as you uploaded it**, even though what is kept on the
  server is a smaller copy of a very large upload. The scale stays exact; below **1:1** you are only
  placing the marks less precisely, and the viewer says so.
- **Some older photos cannot be measured.** A large photo uploaded before Stamporama recorded
  original sizes may have been shrunk by an amount nothing remembers, so the measuring tools are not
  offered on it and the line under the viewer says why. Ring, Line and Snapshot still work.

**Set as the stamp's size.** With the **Size** tool, drag a box around the stamp; its width and
height appear under the viewer with **Set as the stamp's size**. If the stamp states no size yet, it
is written straight away. If it already states one — whole or only half — you are shown that size and
asked before it is replaced, since it may itself have been measured carefully. On a copy carrying
several stamps the figure is measured but not offered, because the piece is a copy of none of them.

## The issue page

*Left column:* Details, Checklists, Stamps, Catalog value. *Right column:* Completeness, Copies,
Offers. Details and Checklists are always there.

- **Identity** — the issue number, name and year, the declared catalog range, and the
  required/total stamp count. At the end of the line, **Edit** opens the issue dialog — the same one
  the Issues list opens, over this issue — for its name, year, area, catalog numbers, checklists and
  [tags](tags.md). The issue's tags sit on this line as chips; they say nothing about the stamps
  inside the issue, which carry their own.
- **Details** — area, year, stamp counts, and the catalog value of the required stamps with how
  many of them are actually priced.
- **Checklists** — every [checklist](collections.md#checklists) the issue carries, in the order
  you arranged them: its name, how many stamps are on it, how many of those you hold (in any
  disposition and condition, with **×** and the number of complete sets once there is one) and its
  catalog value. The figures are the ones the Issues list's checklist badge and the Completeness
  card show, so they always agree. **Click a checklist** to narrow the Stamps tree below to it;
  click it again to see every stamp. **Manage…** opens the checklist editor — the same one the
  Issues list opens from the issue's **⋮ → Checklists…** — and the page picks up whatever you
  changed as soon as you close it. An issue with no checklist says so, and **Manage…** is where you
  create the first one.
- **Completeness** — the breakdown described below.
- **Catalog value** — averages across catalogs for the stamps on one
  [checklist](collections.md#checklists), full breakdown behind the button. An issue collected more
  than one way gets one card per checklist, each named after it.
- **Stamps** — the whole tree, drawn out rather than behind an expander, each stamp linking to its
  own page, with **its own photo on its own line**. There is no separate gallery on this screen:
  a strip of thumbnails away from the tree would leave you matching pictures to catalog numbers by
  eye, which is the work the tree is already doing for you. When the issue carries more than one
  checklist — or you have picked its only one on the Checklists card — the card header holds a
  **Checklist** filter that narrows the tree to the set you pick — a parent whose variant matched stays as dimmed context, so a variant never loses the
  number it is read under.
- **Copies** — every copy you hold from any stamp in the issue.
- **Offers** — every offer holding a copy from this issue.

### Completeness

The **Completeness** card answers "how far along am I?" from the copies you actually hold, rather
than as one owned/not-owned figure. It is a grid:

- **Rows** are dispositions: *Any*, *In collection*, *For sale*, *For trade*. These **overlap** — a
  copy can be in the collection *and* for sale — so the rows never add up to *Any*.
- **Columns** are *Any condition* plus one per stamp condition.
- Each cell reads **owned / required**, and after a **×**, how many **complete sets** those copies
  make.

A **piece carrying several stamps** ticks none of its stamps off, here or anywhere else: you cannot
supply one of them off a cover that will be sold whole. See
[covers and other pieces carrying several stamps](inventory.md#covers-fragments-and-other-pieces-carrying-several-stamps).

A complete set is limited by the thinnest stamp on the checklist: if every stamp on it has three copies
but one has only one, you have one complete set, not three. A single missing stamp makes it zero,
however many duplicates of the others you hold — which is the point of the figure.

Sold, disposed-of and never-usably-delivered copies are not counted, matching the copies-held badge
on the catalog lists.

A copy filed under a **variant** of a stamp on the checklist counts for that stamp. If the
checklist asks for `226` and the two copies you hold are a `226xw` and a `226yw` — filed under
`226` because that is what you eventually identified them as — the set counts them: a variant is
another way of holding the stamp it hangs under, exactly as it is for
[catalog value](collections.md#the-valuation-dialog). It works at any depth, so a copy three levels
down still counts. Children that are **distinct entries** rather than variants — an error, a plate
flaw, an overprint with its own number — do not: those are their own thing to collect. Which is
which is the [subtype](collections.md#stamp-subtypes) on the child, the same setting the rest of
the app reads the variant tree by. If the checklist names *both* a stamp and one of its variants,
a copy counts for the closer of the two only — one piece of paper cannot fill two slots of one set.

**Formats** are tabs above the grid — *Any format*, *Single*, and one per
[format](inventory.md#pairs-blocks-and-other-multiples) you hold copies of. They appear only once the checklist is held in
more than one format, so a set you own singles of shows the plain grid it always did. Picking a
format asks the sharper question — *do I have the whole series in blocks of four?* — and a
**multiple never counts toward a set of singles**, exactly as a used copy never counts toward a
mint set. *Any format* is the roll-up: it says whether you hold the series at all, in whatever
shape.

There is **one card per [checklist](collections.md#checklists)** the issue carries, each titled
after it — an issue collected basic and specialized shows both, side by side. An issue with no
checklist at all has no set to be complete against, so it has no Completeness card either; add a
checklist from the **Checklists** card's **Manage…** and the card appears.

Each card also carries **Add missing to want list…**. It opens a dialog that creates one open
entry on your [want list](wants.md) for every stamp on that checklist you do not hold and do not
already have an open want for, after saying how many. It asks whether you want the set as **main
stamps** or as **variants**, and on what terms and at what priority; left on its defaults, the
entries accept **anything**. See
[Main stamps or variants](wants.md#main-stamps-or-variants). It runs once, when you confirm it:
changing the checklist later does not touch the want list, and running it again adds nothing that
is already there. *Do not hold* means what the grid above it
means, variant children and all — a stamp the card counts as held is not wanted again.
