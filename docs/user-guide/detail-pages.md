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

These pages are **read-only**. Everything on them is still edited where it always was: the copy
form, the stamp dialog, the issue dialog. The popups you already use (**View copies**, **View
offers**, **Show valuation**) also stay exactly where they are — they answer one question
without leaving the list, and these pages are for when you want the whole picture instead.

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

## The copy page

*Left column:* Details, Notes, Photos, Catalog prices. *Right column:* Purchase, Sale, Offers. Only
Details is always there; the rest appear when the copy has them.

- **Identity** — the internal copy number, the stamp it is a copy of (click through to the stamp
  page), and its catalog numbers.
- **State chips** — disposition (*In collection*, *For sale*, *For trade*), delivery state, *Sold*
  and any disposal.
- **Details** — condition, certificate status, physical format, area, issue, storage location and
  in-location ref, cost-basis, catalog value, and the date it was added.
- **Photos** — the full gallery, not just the first photo. Click any thumbnail to view it
  full-size.
- **Catalog prices** — the cross-catalog averages for the copy's stamp, with **Full breakdown**
  opening the same per-edition dialog the row menu opens.
- **Notes** — the copy's own text.
- **Purchase** — the purchase order the copy came from, when it came from one.
- **Sale** — when the copy has been sold: the sale, its date and status, the platform, the buyer,
  the line price, the offer it went out through, and whether it has been packed.
- **Offers** — every offer that holds this copy, across all platforms and all states.

## The stamp page

*Left column:* Details, Issues, Photos, Catalog prices, Variants. *Right column:* Wants, Copies,
Offers. Only Details is always there.

- **Identity** — catalog numbers, name, subtype, the Colnect link (or a Colnect search when no
  item-ID is recorded), the copies-held badge — carrying a *(+N)* for the copies held of this
  stamp's variants when there are any, and opening its disposition breakdown on click — and the
  headline catalog price.
- **Details** — area, issue date, subtype, and the copies held broken down by disposition, ending
  with the copies held of this stamp's variants when there are any
  ([Copies held](collections.md#copies-held-on-the-catalog-lists)).
- **Issues** — which issues the stamp belongs to, and which of each issue's
  [checklists](collections.md#checklists) count it. *Optional* means the issue holds it but no set
  counts it.
- **Photos** — the stamp's catalog photos, full gallery.
- **Catalog prices** — averages inline, full per-edition breakdown behind the button.
- **Variants** — the base stamp this one hangs under, and the variants hanging under it. Each is a
  link to its own page.
- **Copies** — the copies you hold of exactly this stamp (a variant's copies are its own, never
  rolled up into its parent).
- **Wants** — everything recorded on your [want list](wants.md) for this stamp: the acceptance
  chips and the priority, exactly as the want list draws them. Open wants lead; closed ones follow,
  faded — on a single stamp a closed want is the useful record that you were looking for it and
  found it. Read-only; the form lives on the want list.
- **Offers** — every offer holding a copy of this stamp.

## The issue page

*Left column:* Details, Stamps, Catalog value. *Right column:* Completeness, Copies, Offers. Only
Details is always there.

- **Identity** — the issue number, name and year, the declared catalog range, and the
  required/total stamp count.
- **Details** — area, year, stamp counts, and the catalog value of the required stamps with how
  many of them are actually priced.
- **Completeness** — the breakdown described below.
- **Catalog value** — averages across catalogs for the stamps on one
  [checklist](collections.md#checklists), full breakdown behind the button. An issue collected more
  than one way gets one card per checklist, each named after it.
- **Stamps** — the whole tree, drawn out rather than behind an expander, each stamp linking to its
  own page, with **its own photo on its own line**. There is no separate gallery on this screen:
  a strip of thumbnails away from the tree would leave you matching pictures to catalog numbers by
  eye, which is the work the tree is already doing for you. When the issue carries more than one
  checklist, the card header holds a **Checklist** filter that narrows the tree to the set you
  pick — a parent whose variant matched stays as dimmed context, so a variant never loses the
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

A complete set is limited by the thinnest stamp on the checklist: if every stamp on it has three copies
but one has only one, you have one complete set, not three. A single missing stamp makes it zero,
however many duplicates of the others you hold — which is the point of the figure.

Sold, disposed-of and never-usably-delivered copies are not counted, matching the copies-held badge
on the catalog lists.

There is **one card per [checklist](collections.md#checklists)** the issue carries, each titled
after it — an issue collected basic and specialized shows both, side by side. An issue with no
checklist at all has no set to be complete against, so it has no Completeness card either; add a
checklist from the issue's **⋮ → Checklists…** and the card appears.

Each card also carries **Add missing to want list**. It creates one open entry on your
[want list](wants.md) for every stamp on that checklist you do not hold and do not already have
an open want for. The entries it creates accept **anything** — a gap says only that the stamp is
missing, not on what terms you would buy it — so edit them afterwards to say what you would take.
It runs once, when you press it: changing the checklist later does not touch the want list, and
pressing it again adds nothing that is already there.
