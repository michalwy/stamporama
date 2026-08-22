# Inventory

Your **inventory** is the physical copies you own. A **copy** is a single physical stamp:
each copy is its own record, so two copies of the same stamp can differ in condition,
certificate, disposition, storage, and notes. There is no "quantity" — three
copies of the same stamp are three rows.

Open the **Inventory** screen from the **Collection** section of the sidebar.

Each copy also has a page of its own, gathering everything about it — including its purchase, its
offers and the sale it left on — in one place. Open it from the row's **⋮** menu with **Open copy
page**; see [Detail pages](detail-pages.md).

## The inventory list

Each row shows:

- The copy's **internal number** (e.g. `#00123`) — see [Internal copy number](#internal-copy-number).
- The linked stamp's **catalog number**, **name**, and **issue**. A catalog-number chip is
  **clickable — it copies the number** (see [Copying a catalog number](#copying-a-catalog-number)).
- The **condition** and any **certificate status**.
- **Disposition** markers — *In collection*, *For sale*, *For trade* — a copy can carry
  any combination at once. Copies you intend to sell are composed into [offers](offers.md).
- The copy's **catalog value** (see [Copy value and holdings total](#copy-value-and-holdings-total)).
- Its **cost-basis** — what the copy actually cost you — when it came from a
  [purchase](purchases.md) (see [Cost-basis](#cost-basis)).
- Its **storage location** (a 📍 chip with the location path and any in-location ref),
  when the copy has been filed — see [Locations](locations.md).
- Its **delivery state** — but only when the copy is **not** delivered yet: a chip reading
  *Ordered*, *In transit*, *To sort*, *Not delivered / missing*, or *Damaged*. A delivered copy shows no
  chip, since that is the normal state of everything you hold. See
  [Delivery state](#delivery-state).
- Its **notes**, printed in full on a line of their own directly under the row, when the
  copy has any. A copy without notes gets no extra line, so the list keeps its usual height.
- A **photo thumbnail** at the left of the row, when the copy has any — a single larger
  preview of the first photo. If the copy has more than one photo, a counter (e.g. **1/3**)
  appears and **‹ / ›** controls step through them in place. The **front** and **back** carry
  a corner badge (**F** / **B**) to set them apart from extra photos; click the thumbnail to
  view it full-size. See [Photos](#photos).

If a copy is linked to a base stamp whose specific variant is unknown, it is flagged
**unknown variant**. Such a copy is valued cautiously and its uncertainty stays visible;
you can pin down the exact variant later — see [Identifying a variant](#identifying-a-variant).

A stamp counts as "unknown variant" only when it actually has **variant** children
(see [Subtypes](collections.md#stamp-subtypes)). If all of its children are distinct
entries — errors, overprints and the like — the stamp is a concrete stamp in its
own right: a copy on it is valued by its own catalog price and is **not** flagged
uncertain. A stamp with a mix keeps the unknown-variant treatment over its variant
children only. This holds at **any depth**: an intermediate variant that itself has
variant children is treated as "unknown which of those" exactly like a top-level base
stamp — so a copy linked to it is flagged uncertain and valued over its own variant
children.

The list loads more rows as you scroll. Your filters, sort, and position are kept in the
page URL, so you can bookmark or share a filtered view.

### Filters and sorting

The inventory list filters the same way the [Stamps](collections.md) list does: a left
**area panel** plus a toolbar of filters, all kept in the page URL.

The toolbar **stays pinned to the top of the window** as you scroll a long list, so search,
sorting and the filter chips are always in reach — on every list that has one: Issues,
Stamps, Copies, Offers, Sales and Purchases.

- **Area** — the panel on the left lists your collection's [areas](collections.md) as a
  tree. Pick one to show only copies whose linked stamp belongs to that area; selecting an
  area includes its nested sub-areas. Choose **All areas** to clear it.
  Once you pick an area that *has* sub-areas, a small **+ sub-areas / this area only** switch
  appears above the tree. **+ sub-areas** is the default and the usual way to browse; **this
  area only** narrows the list to what sits directly on the area you picked, which is how you
  find pieces that were never filed into a sub-area. The switch is remembered, and it applies to
  every list with an area panel — Issues, Stamps, Copies and the stamp picker — so they always
  agree about what an area selection means.
- **Search** — type in the search box to match copies by the linked stamp's **name**, its
  **issue name**, a **catalog number**, or the copy's own **location ref** (case-insensitive).
  A catalog number can be typed bare (`200`) or with its full prefix and any spacing
  (`Mi PL 200`, `MiPL200`); when the text starts with a known vendor abbreviation the match is
  narrowed to that vendor. Typing a shelf reference such as `A234` finds the copies filed under
  it, so you can go from a piece in hand straight to its record. A plain number also looks up an
  **internal copy number** — `123`, `00123` and `#00123` all find copy `#00123` — alongside the
  text matches, so a number that is also a catalog number still finds both.
- **Issue** — filter to copies of stamps in a single issue. Start typing to pick one; the
  suggestions are scoped to the area selected on the left.
- **Disposition** — toggle *In collection*, *For sale*, and *For trade*. With none
  selected, all copies are shown. Selecting several narrows to copies matching every
  chosen marker.
- **No photos** — toggle to show only copies that have no [photo](#photos) attached, so
  you can quickly find the pieces still waiting to be photographed.
- **Missing catalog value** — toggle to show only copies with **no catalog value** recorded
  for their condition (those showing **—**), so you can find and fill pricing gaps in bulk.
  Pairs with the **+ catalog value** price link below. The holdings totals and year panel
  follow this filter too.
- **Not offered on…** — pick a [platform](offers.md) to show only copies **marked for sale**
  that have **no offer** on it yet — your worklist of what still needs listing there. A copy
  already listed on a *different* platform still shows up, since the same copy can be offered on
  several platforms at once. Only offers that are done (**sold** or **withdrawn**) stop counting;
  a copy sitting in a **preparing**, **ready**, **active**, or **paused** offer on that platform
  is treated as already handled. One exception to the "other platforms don't count" rule: a copy
  held by an offer that is **in active bidding** anywhere is left out entirely — a bid commits it
  to a pending sale, so listing it again would risk selling the same piece twice.
  Copies marked **Not delivered / missing** or **Damaged** are left out as well: they are not in
  your hands and never will be, so they cannot be listed. Copies still on their way to you
  (*Ordered*, *In transit*, *To sort*) do show up — those are exactly the ones worth preparing.
  Copies you have marked as [never listed on that platform](#copies-you-never-list-on-a-platform)
  are left out too — that is what the marking is for.
  This filter appears once you have at least one offer platform,
  and the holdings totals and year panel follow it too. Your chosen platform here is **remembered**
  for this collection, so the filter comes back the way you left it next time.
- **Never listed on…** — the same dropdown's second group, listing the copies you have deliberately
  set aside from a platform, so you can review them and let any of them back in. Unlike the worklist
  above it makes no assumption about disposition: it shows exactly what carries the marking. This
  one is **not** remembered between visits — it is somewhere you go to look, not the list you work
  from.
- **Include sold & traded** — copies that have [sold](sales.md), and copies you gave to a partner in
  a closed [trade](trades.md), are **hidden by default**, so the list shows only what you still hold.
  Toggle this on to bring them back into view (for example to look up what a piece went for); each
  one then carries a **Sold** or **Traded away · #7** chip, so a copy that has left the collection is
  never mistaken for one still in it. One toggle covers both, because gone is gone. The holdings
  totals and year panel follow this filter too.
- **Include no longer held** — copies you have marked as [no longer held](#copies-you-no-longer-hold)
  are **hidden by default**, for the same reason sold ones are: the list answers *what do I have*.
  Toggle this on to bring them back into view. The year panel follows this filter too; the holdings
  totals always account for them, on their own **Written off** line.
- **Delivery state** — show only copies in the delivery states you tick. Like the condition filter
  it takes **several at once**, which is how you ask the question that actually comes up: ticking
  *Ordered*, *In transit* and *To sort* together is "everything still on its way to me". Or tick one
  — every copy marked *Damaged*. See [Delivery state](#delivery-state).
- **Certificate** — show only copies carrying the certificate statuses you tick, **No certificate**
  among them: a copy having none is an answer, not the absence of the question, so you can ask for
  the uncertified pieces on their own or for "certified *or* not yet certified" together. Like the
  format filter it appears only once your collection defines certificate statuses.
- **Condition** — show only copies in the conditions you tick. It takes **several at once**: click
  it and tick as many grades as you like, and the list shows copies in *any* of them — "the mint
  grades" is as ordinary a question as one grade is. The control reads the grade's name when one is
  ticked and counts them when more are (`3 conditions`); **All conditions** at the top of the list
  clears it. Everything that follows the list follows this filter too — the year panel, the holdings
  totals, and the grouped views.
- **Location** — show only copies stored in a chosen [location](locations.md). Selecting a
  location includes copies in every location nested inside it, so filtering by a cabinet
  shows the copies in all of its stockbooks at once. Pick a location that has others nested
  inside it and the same **+ sub-locations / this location only** switch appears beside the
  select — *this location only* answers "what is loose in the cabinet itself". Like the area
  one, it is remembered, and the holdings totals and year panel follow it.
- **Sort** — by date added, ascending or descending.

The holdings summary totals follow whatever the filters are showing, so a filtered view
tells you the catalog value and purchase cost of just those copies.

## The want marker

A copy whose stamp is on your [want list](wants.md) carries a **crosshair chip**. Click it for
every open want on that stamp; the chip is **ringed** when this copy's own condition, certificate
and format would satisfy one.

Holding a copy never closes a want, so on this list the chip is usually the **upgrade** signal: you
have one, and you are still after a better one. A grouped row carries it too — a group is one stamp
at one condition, so the answer covers every copy in it.

## Copy value and holdings total

Each copy is valued from your **catalog prices** — this is independent of what you paid
for it. A copy's value is the price for its **own condition and certificate
status**, taken from the **primary catalog of the stamp's area** at that catalog's
**latest recorded edition**:

- **Identified copy** — the price of its specific variant.
- **Unknown-variant copy** — if the base stamp itself has a price, that is used;
  otherwise the **lowest** price among the base stamp's variants (compared in your base
  currency). Either way the value is an estimate: it is shown in italics with a leading
  `~`, because the exact variant isn't settled. Resolving the variant later replaces the
  estimate with that variant's own price.

The certificate status must match exactly — a copy with a certificate is only valued from
a price recorded *for that certificate status*; there is no fall-back to the no-certificate
price. A copy with no matching catalog price shows **+ catalog value** in the value column —
click it to record one without leaving the list. See
[Adding a catalog value](#adding-a-catalog-value).

Each value shows the catalog price in its **own recorded currency**, with the conversion to
your collection's **base currency** alongside it — matching how prices read on the issue
list. Totals are summed in the base currency. A price in a currency with no available
exchange rate is shown in its own currency only and left out of the total.

Above the list, the holdings summary bar sums three figures over every copy that matches your
current filters (change the filters and all of them follow):

- **Catalog value** — what your holdings are worth, as described above. It also tells you
  how much of the total is uncertain (unknown-variant estimates) and how many copies are
  unpriced or could not be converted.
- **Market value** — what the same copies have actually fetched, each valued at the median of the
  closed auction lots recorded for its own condition, certificate and format (see
  [Market value](collections.md#market-value)). The line always says **how many copies are behind
  the figure** — *"from 14 of 112 copies · 98 with no auction results"* — because market value only
  exists where lots have been recorded, and a total covering a slice of the collection must not
  read as the whole of it. Copies with no results contribute nothing; nothing is substituted from
  the catalog.
- **Purchase cost** — what you actually paid, summed from the frozen
  [cost-basis](#cost-basis) of the same copies (in your base currency). It calls out copies
  whose cost is still **pending** (on an open purchase lot) or has **no cost recorded** (added
  by hand, or dropped from a lot) — those contribute nothing to the total, the same way the
  per-copy cost-basis distinguishes them.

Comparing the lines shows list price, what the market pays and what you paid, side by side.

All three lines cover the copies you **actually hold**. A copy you have marked as
[no longer held](#copies-you-no-longer-hold), and one whose delivery state is *Not delivered /
missing* or *Damaged*, is worth nothing to you however the catalog prices it, so it counts towards
none of them. It is not simply dropped, though — a further line appears when there are any:

- **Written off** — what those copies cost you, in red. You really spent it, and leaving it out
  would make your purchases look better than they went. Only a cost is shown here, never a catalog
  value.

This line appears whether or not the **Include no longer held** filter is on: the totals always
account for the whole filtered scope, and the written-off line is what keeps the two halves adding
up. Copies that have **sold** are a different story and never appear here — those are proceeds, not
a loss.

## Cost-basis

Where **catalog value** is what a copy is worth, its **cost-basis** is what you actually
**paid** for it — the figure profit or loss is measured against when you sell. Cost-basis
comes from [purchases](purchases.md): the price you paid for a lot, plus its fair share of
the order's shipping, is split across the lot's copies when the lot is closed, and each
copy's share is frozen in your **base currency**.

On a copy's row the cost-basis shows as:

- **cost 12.34 EUR** — the frozen amount, once the copy's purchase lot has been closed.
- **cost pending** — the copy belongs to a purchase lot that is still **open**; its
  cost-basis is frozen only when you close the lot (see
  [Closing a lot](purchases.md#closing-a-lot)).
- *nothing* — the copy has no cost-basis: you added it by hand rather than through a
  purchase, or it was marked *not delivered* and dropped from its lot.

A frozen cost-basis is **not** recomputed automatically if you later edit catalog prices
or re-point the copy to another variant — to change it, reopen the lot, correct the copies,
and close it again.

### Going to a copy's purchase

A copy bought through a [purchase order](purchases.md) carries a **Go to purchase** entry in its
**⋮** menu, naming the order (supplier and date) underneath. It opens that purchase and takes you
straight to the **lot the copy is in**: the lot's card opens, scrolls into view and stays ringed
until you dismiss the mark with its **✕**. A copy you added by hand has no purchase behind it, so
the entry is simply not there.

If a copy *should* have a purchase behind it but doesn't — you entered it before recording the
receipt — you can
[attach it to a lot after the fact](purchases.md#attaching-a-copy-that-already-exists).

## Delivery state

Every copy carries a **delivery state** — where the physical piece is, as opposed to what you
intend to do with it (that is its [disposition](#the-inventory-list)):

- **Ordered** — bought but not yet on its way. This is what [purchase](purchases.md) intake
  starts a copy as.
- **In transit** — on its way to you.
- **To sort** — arrived, still waiting to be sorted.
- **Delivered** — sorted and in hand. A copy you add by hand starts here.
- **Not delivered / missing** — never arrived, or went missing. It is dropped from its purchase
  lot when the lot closes.
- **Damaged** — arrived damaged. It stays in its lot and keeps its cost share.

On the Copies list only a copy that is **not** delivered is chipped, so the common case stays
uncluttered; the chip is tinted by state and explains itself on hover. To see the whole picture,
use the **Delivery state** filter in the toolbar. The full lifecycle, including the quick-advance
control and bulk edits, is described under
[The delivery lifecycle](purchases.md#the-delivery-lifecycle-ordered--to-sort--delivered).

You can change a single copy's delivery state in the **Edit copy** dialog, or many at once from
the [purchase intake screen](purchases.md).

Delivery state matters beyond bookkeeping: **only a delivered copy can be listed for sale**
(see [Adding a copy to an offer](#adding-a-copy-to-an-offer)).

## Copies you no longer hold

A copy can leave your hands **after** it arrived: lost, damaged in storage, given away, thrown
out. That is its own axis, separate from delivery state and from disposition — the piece did
arrive and you did pay for it, and you may still want its record.

Open a copy's **⋮** menu and choose **No longer held**. Pick a reason — **Lost**, **Damaged**, or
**Other** — and add a note; the note is required for *Other*, which on its own says only that the
copy is gone. If the copy turns up again, the same menu offers **Mark as held again**, which
reverses it completely.

Two things stop the action, and both say so:

- **Only a delivered copy can be marked.** Something that never arrived belongs to
  [delivery state](#delivery-state) instead, which handles it differently — a *Not delivered*
  copy leaves its purchase lot and its cost share goes to the others.
- **A copy in a live offer must have that offer withdrawn first**, or the listing would be
  advertising something you cannot ship. The message names the offer.

What marking a copy does **not** do is touch the purchase: its cost basis, its purchase lot, its
internal number, its photos and its refinement history all stay exactly as they were, and the
number is never handed to another copy. What changes is that the copy:

- carries a red **⊘** chip on its row, with the reason, the date and your note on hover;
- disappears from the Copies list unless you turn on **Include no longer held**;
- stops counting towards **collection value** and towards the copies-held badge on the Stamps and
  Issues lists;
- stops being offered for listing anywhere, and cannot be added to an offer;
- has what it cost reported on the holdings bar's **Written off** line — see below.

The **Edit copy** dialog shows the disposal beside the delivery state rather than instead of it:
the two are independent, and both stay readable.

## Copies you never list on a platform

Some copies you keep for sale but never intend to list on one particular
[platform](offers.md) — the postage is wrong for it, the piece is promised elsewhere, whatever the
reason. Left alone, every one of them keeps answering the **Not offered on…** worklist for that
platform, and after a few hundred of them the copy that genuinely needs listing is impossible to
find among them.

Marking a copy **never listed on** a platform takes it out of that worklist and nothing else. The
copy stays for sale, stays in your collection, keeps its value and its photos, and is still offered
for listing on every *other* platform. It is a decision about where you sell, not about the stamp.

There are three ways to set it, for the three situations it comes up in:

- **From a row's ⋮ menu** — while the **Not offered on…** (or **Never listed on…**) filter names a
  platform, every row offers **Never list on ⟨platform⟩**, or **List on ⟨platform⟩ again** if it is
  already set aside. One click, no confirmation: the same menu undoes it.
- **From the selection bar** — tick copies with their checkboxes and press
  **⊗ Never list on ⟨platform⟩** to set aside the whole selection at once. This is how a backlog of
  a thousand is cleared. A selection that is *already* set aside offers the reverse instead. Like
  the row entry, it appears only while a platform is picked in the filter, since the decision names
  one.
- **From the Edit copy dialog** — the **Never list on** control lists your platforms and ticks any
  number of them, so you can answer for all platforms at once without filtering the list first. What
  you leave unticked is *allowed*, so this is also where an exclusion is cleared away from the
  worklist.

A copy that is set aside anywhere carries a muted **⊗ not on ⟨platform⟩** chip on its row, naming
every platform it is kept off.

To see what you have set aside — and to let any of it back in — pick the platform under **Never
listed on…** in the same dropdown that carries the worklist. That list shows exactly the copies
carrying the marking, whatever their disposition.

### Promised in a trade

A copy on the giving side of an **agreed** [trade](trades.md) carries a **Promised · #⟨trade⟩** chip
on its row and on its own screen, naming the trade it is committed to. It is not a marking you set:
it comes from the trade itself, and it goes when the trade closes or is cancelled.

While it stands, that copy cannot go live on a marketplace — activating an offer that holds it is
refused, naming the trade. Everything else about the copy is unaffected: it stays in your collection,
keeps its location and its dispositions, and can still be prepared into a draft offer.

If you later delete a platform contact, the markings that named it simply go with it.

## Viewing copies from the catalog

You don't have to open the Inventory screen to see what you own. Every row across the
app carries a single **⋮** actions button on the right; opening it reveals that row's
actions as a menu. On the **Stamps** list and the **Issues** list, that menu includes
**View copies**:

- On a **stamp** row, **View copies** opens a popup listing every copy you own of that
  stamp.
- On an **issue** row, **View copies** opens a popup listing every copy of *any* stamp in
  that issue — a quick way to see your holdings for a whole issue at once.
- Expanding an issue reveals its individual stamps, each with its own **View copies**
  action for the copies of just that stamp.

The popup shows the same copy details as the Inventory list (condition, disposition,
value, storage, and any [photos](#photos)), but is **read-only** — it's for looking, not
editing. Close it to return to the list exactly where you were; nothing navigates away.
To edit or delete existing copies, use the **Inventory** screen.

## Adding a copy from the catalog

You can record a new copy without leaving the Stamps or Issues list. Alongside
**View copies** in the same **⋮** menu is an **Add copy** action that opens the add-copy
dialog described below, already pointed at the right stamp:

- On a **stamp** row — and on each stamp inside an expanded issue — **Add copy** opens the
  dialog with that stamp pre-selected. You can still **Change** it if needed.
- On an **issue** row, **Add copy** opens the dialog and immediately pops up a stamp/variant
  tree **limited to that issue's stamps** — the same tree as the **Browse…** picker, so
  variants read the same. Pick which stamp the copy is. If you close the popup without
  picking, a **Select a stamp…** button reopens it.

Fill in the rest of the dialog as usual and save. The new copy appears on the Inventory
screen, and any open **View copies** popup for that stamp or issue reflects it.

## Adding a copy

1. Click **Add copy**.
2. **Choose the stamp or variant** in one of two ways:
   - **Type to search** in the field. Suggestions match the stamp name, its issue name,
     **catalog numbers** — including the vendor and area prefix — and the **location ref**
     of any copy you already hold, so a shelf reference such as `A234` finds the stamp filed
     there. Catalog search ignores spacing, so `Mi PL 200`, `Mi PL200`, `MiPL200`, and just
     `200` all find the same stamp. Each suggestion shows its catalog number, name, issue,
     year, and area so you can tell similar stamps apart.
   - **Browse…** opens a larger picker: pick an **area** on the left, filter its **issues**
     on the right, then expand an issue to choose a stamp or one of its variants. The picker
     remembers its area, year, and search text, so it reopens on the same filter you left it
     on — and the remembered text is **selected** when it opens, so you can just start typing
     to replace it. The filter also looks **inside** each issue: a term that matches a stamp's
     name or catalog number (but not the issue's own name) still surfaces that issue, opens it,
     and shows **only** the matching stamps — the rest of the tree is hidden, exactly as it is on
     the [Issues list](collections.md#filtering-the-issues-stamps-and-copies-lists). The stamps a
     match hangs under are kept, faded, because a variant is read through them. An issue that
     matched on its **own** name, year or number shows its whole tree, so nothing is ever hidden
     from a plain browse.

     The issue list loads **as you scroll**, like the Issues screen, and the area, year and
     search filters all narrow it before it is fetched — so the picker opens just as quickly on
     a collection of thousands of issues as on a small one. An issue's stamps are read when you
     open it, which is why a tree can take a moment to appear the first time.

   Choose a specific variant if you know it, or the **base stamp** if the variant is
   unknown. The chosen stamp appears as a summary with a **Change** link to reselect. Its
   catalog numbers show as one **chip each**, carrying the catalog abbreviation and area
   prefix (`Mi·PL 1B`), so a stamp numbered in several catalogs is never a bare list of
   figures — the same is true when you reopen a copy with **Edit**.

   If the stamp isn't in your catalog yet, you can add it without leaving the browser
   (you must still pick an existing **area** first):
   - **+ New issue** (top of the issue list) adds an issue to the selected area. It then
     appears in the list, ready for you to add a stamp to it.
   - **+ New stamp** (at the bottom of an expanded issue's stamp tree) adds a stamp to that
     issue. It then appears in the issue's tree, ready for you to pick like any other stamp —
     it is not selected automatically, and the picker stays open.
   - **+ variant** (next to any stamp in the tree) adds a child under that stamp, which likewise
     appears in the tree ready to pick. It sits at **any depth** — `3` takes `3a`, and `3a` takes
     `3a1` — the same as **Add child stamp** on the Issues list.
3. Choose the **condition** (required) and, optionally, a **certificate status**. Both
   come from your collection's configurable sets.
4. Set the **disposition** flags. New copies default to *In collection* until you've added
   one — after that, see the note below.
5. Optionally file the copy into a **storage location** and add an in-location **ref**
   (e.g. a page or pocket). Picking a location moves the cursor straight to the **Ref** field
   so you can type the ref without an extra click. Only locations that can hold copies are
   selectable — see [Locations](locations.md).

   The **Ref** field is also where the cursor starts when the dialog opens, as long as a
   remembered location has already filled the **Location** beside it: with the condition,
   location and disposition all coming back from the last copy you added, the ref is the one
   field that changes from copy to copy, so bulk intake needs no click before typing. With no
   location filled in, the Ref field is disabled and the cursor is left alone.
6. Optionally add free-form **notes** (e.g. postmark type or a condition detail).
7. Optionally attach **photos** — front, back, and titled extras. See [Photos](#photos).
8. Click **Add copy**. Everything is saved together in one step.

If the copy matches an open entry on your [want list](wants.md), Stamporama shows the
matching wants right afterwards and lets you **close** each one, **narrow** it, or **leave it
open**. Nothing is closed automatically — see [Taking a copy in](wants.md#taking-a-copy-in).

> **Remembered defaults** — your last-used **condition**, **location**, and **disposition**
> are remembered per collection and pre-filled the next time you add a copy — anywhere, whether
> from this dialog or from [lot intake](purchases.md). Adding many copies with the same settings
> (e.g. filing a whole lot into one box) then only takes a stamp pick. Override any field per
> copy; the new choices become the defaults for the next add.

> **Acquisition and cost** — supplier, date, and what you paid — are recorded on a
> [purchase](purchases.md), not on the copy: the copy form captures identity, condition,
> disposition, storage, and notes only. A copy taken in through a purchase carries a
> [cost-basis](#cost-basis); one added here by hand has none.

## Internal copy number

Every copy carries an **internal number** — a plain running number within your collection,
starting at `1` for the first copy you record. It is assigned automatically when the copy is
created and cannot be edited or reassigned: it is meant to be written on the piece itself, on a
stock card, or on a printed label, so it has to keep pointing at the same copy forever.

The number appears on every inventory row, next to the condition, and in the title of the copy's
**Edit** dialog.

Typing `i 123` in the sidebar's **Jump to…** box takes you straight to it — see
[Quick jump](quick-jump.md), which does the same for offers, issues, purchases, sales and auction
lots.

It is shown zero-padded — `#00123` — so a column of numbers lines up. How many digits it pads to is
your choice, under **Settings → General → Copy number width**: pick `2` and the same copy reads
`#42`, pick `8` and it reads `#00000042`. That is a display setting only — nothing is renumbered,
and a number wider than the setting simply renders in full. Listing templates can override it per
token with `{itemNo:3}`, and can use the number at all through the
[`{itemNo}` token](contacts.md#adding-and-editing).

Two things to expect:

- **Numbers are never reused.** Deleting copy `#00123` retires that number — the next copy you add
  continues past the highest number handed out, it does not fill the gap. A number you have already
  written on a piece must never turn up on a different one.
- **Numbering is per collection.** Each collection starts again at `1`, so the numbers are yours
  rather than an artifact of the installation.

To find a copy by its number, type it into the inventory search box — `123`, `00123` and `#00123`
all work.

Copies that already existed before this feature were numbered in the order they were added, oldest
first.

## Editing a copy

Open the row's **⋮** menu and choose **Edit**. The same dialog opens with the copy's
current values. Changing the stamp to a more specific variant re-points the copy and
records the change in its refinement history. The dialog also carries the **Never list on**
control — see [copies you never list on a platform](#copies-you-never-list-on-a-platform).

To edit the **stamp** a copy points to — its name, catalog numbers, or catalog prices — choose
**Edit stamp** from the same **⋮** menu. It opens the shared stamp editor (the one on the Stamps
and Issues lists), so you can fix stamp-level details without navigating away from Inventory. Edits
here apply to the stamp itself, so every copy of it reflects the change.

## Pairs, blocks and other multiples

A copy has a **Format** alongside its condition and certificate: a horizontal pair, a block of
four, a strip of three, whatever your collection needs. Leave it as **Single** — the default —
for an ordinary single stamp; there is no "single" entry to pick, because a copy with no format
set *is* the single. Only multiples get a chip on the list row, so the common case stays quiet.

You can set the format wherever a copy is first described — the add and edit dialogs, and the
identification step of [lot intake](purchases.md#identifying-stamps-intake) when you are taking in a
single stamp.

The format sits on the **copy**, not on the stamp. That matters when a stamp has variants: you
attach the pair to whichever level of the variant tree you have actually identified, exactly as
you would a single. A pair you have narrowed down to `309B` but no further is recorded against
`309B` with format *Horizontal pair* — you do not need a separate "pair" stamp at every level of
the tree, and you do not lose the fact that the variant is still open.

**A multiple is never split into singles.** A block of four is one copy, one row, one line in your
holdings — not four. Completeness works the same way it does for condition: just as a used copy
does not count toward a complete mint set, a block does not count toward a set of singles. You ask
separately whether you have the series in singles, in pairs, or in blocks — the format tabs on an
issue's [Completeness card](detail-pages.md#completeness) are where that question is answered.

**Se-tenant and gutter combinations are different.** When the catalog gives the combination its own
number — Michel `S`, `W`, `K`, `Zd` — it is a distinct catalog entry, so record it as its own stamp
with that number, not as a format of one of its parts. The test is whether the catalog numbered it
separately, not whether it holds more than one stamp.

Formats are managed in **Settings → Conditions & formats**. A format that is used by any copy or
any catalog price cannot be deleted.

**Formats in other languages.** Once a platform lists in a language other than your collection's
default, the format's **Name** and **Abbreviation** fields each grow their own 🌐 button, exactly as
[conditions](collections.md#conditions-in-other-languages) do — and they fall back independently, so
you can translate *Block of 4* as *Viererblock* while leaving `Blk4` alone. These feed the
`{format}` and `{formatAbbr}` tokens in [listing texts](contacts.md#adding-and-editing).

### What a multiple is worth

Catalog values are recorded per format, on the same grid as everything else: the stamp editor's
**Prices** tab has a row of format tabs above the condition × certificate grid, starting with
**Single**.

Most of the time you will not type these in. Catalogs publish multiples as a **multiplier** — one
Viererblock factor for a whole issue — and record an explicit price only where a multiple is out of
line. Stamporama follows that: set the multipliers once under **Settings → Conditions & formats →
Format multipliers**, and every format's price is derived from the single's. Derived values appear
in the grid as greyed, dashed placeholders — nothing is stored. Type over one where the catalog
disagrees and it becomes a real price that always wins; clear it to fall back to the derived value.

A multiplier can be pinned to an **area** (covering everything beneath it), an **issue**, and a
**condition** — used blocks are often scarcer relative to mint than a single factor can express. A
multiplier with none of these set is your collection-wide default. When several could apply, the
narrowest anchor wins, in this order: **issue** first, then the **nearest area**, then
**condition**. So a factor set on an issue beats a collection-wide factor set on "used".

You set each one where its scope lives, so you never pick the thing it applies to out of a list:

- **Collection-wide and per-area** — Settings → Conditions &amp; formats → Format multipliers.
- **One area** — also from that area's **⋮** menu under Areas, which is usually quicker.
- **One issue** — from that issue's **⋮** menu on the Issues list. Per-issue multipliers are not
  listed in Settings: you can have one for every issue and every format, so that list would be
  thousands of lines long. Each issue's own row shows just its own.

A scope's dialog lists only what is set on that area or issue itself — not what it inherits from
above. To change an inherited multiplier, go to the area it was set on.

A copy that is a multiple is **valued as that multiple**: its own recorded price if one exists,
otherwise the single's scaled by the multiplier that applies to it. If neither exists the copy
counts as unpriced — the single's own figure is never used for a block, because it is a different
thing's price.

### Filtering the list by format

Once your collection has any formats, the Copies list grows a **format** filter beside the
condition one. It works the same way, multi-select included: tick a format to see only those copies,
or **Single** to see only the ordinary ones — and tick both to see, say, every pair *and* every
single while leaving blocks out. Leaving it on *All formats* shows everything.

### Seeing a format's prices on the Stamps and Issues lists

The Stamps and Issues lists show one catalog value per row, picked by the **Price for**
condition switcher. Next to it sits an **as** switcher for the format, defaulting to **Single**;
switch it to a block and every price column shows the block's value instead. Like the filter above,
it only appears once your collection has formats, and your choice is remembered per collection.

A value that had to be **derived** from the single by a multiplier is shown in grey italics with a
leading `~`, the same marking used for an estimate from an unidentified variant — hover it to see
which of the two it is. An issue's total says how many of its stamps were counted that way.

The **+ catalog value** link always records the **single's** value, even while a block column is
showing — see [Adding a catalog value](#adding-a-catalog-value) below. What the switcher changes is
what the dialog *tells* you: it works the block's value out from the single you are typing and shows
it under the input.

## Adding a catalog value

Click a copy's **value** in the list to price it in place — a **+ catalog value** link when the
copy is unpriced, or the value itself (click to edit) when one is already recorded. This is the
same price link used on the [purchase](purchases.md) intake screen. A dialog opens showing the
stamp, its catalog numbers, the copy's condition (and any certificate), and any prices already
recorded, with one input per catalog active on the stamp's area — the primary catalog focused
first. Enter the value(s) and save; each lands on the latest edition of its catalog for this
condition, and the copy's value updates in place.

**It always records the single's value** — never a block's, a pair's or a strip's, whatever format
the copy or the column on screen is. Catalogues quote singles, and the app works a multiple out from
that figure using the format's multiplier, so a single value keeps every multiple of that stamp
right at once. When the copy on screen is not a single, a small line under each input says what it
comes to: *4-blk: × 2.2 = 27.50 EUR*, recalculated as you type. Two things it also tells you there:

- if a value is **already recorded explicitly** for that format, it is named — the multiplier does
  not apply to it, and nothing you type here changes it;
- if **no multiplier is set** for that format, it says so — the copy stays unpriced until you set
  one, or price the format explicitly.

To price a multiple *differently* from what the multiplier gives — a block that a catalogue prices
in its own right — use the stamp's **Prices** tab (a copy's **⋮** → **Edit stamp**), which shows the
whole condition × format grid and what each derived value would otherwise have been.

To work through the gaps in bulk, turn on the **Missing catalog value** filter to list only the
copies that still need pricing, then click each row's **+ catalog value** in turn.

## Adding a copy to an offer

You can list a copy for sale without leaving the Inventory screen. On a copy that is
marked **For sale**, the row's **⋮** menu shows an **Add to offer** action. It opens a picker of
your [offers](offers.md):

- A **state** panel on the left filters by **Preparing / Active / Paused** (with counts) — the
  offers you're still composing come first.
- The search box matches by offer, platform, set, **catalog number**, or the **location ref** of
  a copy inside a set.
- Each offer expands to its existing sets; **Show contents** reveals the exact copies a set holds.

Choose where the copy lands: **＋ New set** on an offer (a fresh single-item set), or an
**existing set** — dropping it in turns that set into a series sold together. Confirm with
**Add to offer**. Only the offer you pick is affected.

Starting a brand-new offer from the copy is in the same picker: **＋ Create new offer** opens the
offer header form (platform, currency). When the copy has a [catalog value](#copy-value-and-holdings-total),
the **asking price** is pre-filled with it — converted into the offer's currency and fully editable,
so you can accept, adjust, or clear it. (A copy with no catalog value leaves the price blank.)
Creating the offer seeds it with this copy as a single-item set and returns you to the Inventory
list. Add more copies later from the offer's compose screen — see [Offers](offers.md).

When you already know you want a fresh offer, the **⋮** menu also has **Add to new offer** — it
skips the picker and opens that create form straight away, seeded with this copy. Cancelling it
closes the dialog. (The full **Add to offer** picker is still there when you want to add the copy
to an offer you already have.)

Both actions need the copy to be **delivered** (in hand). On a for-sale copy that has not
arrived, they stay in the menu but are **greyed out**, with the reason spelled out underneath
(*"Only a delivered copy can be listed — this one is in transit."*). Set the copy's
[delivery state](#delivery-state) to *Delivered* to list it. A copy that is not marked
**For sale** shows neither action — mark it for sale first.

An offer that already lists this copy is shown but disabled — a copy is never listed twice in the
same offer. A copy that has already **sold** elsewhere can't be added at all.

### The same stamp in the same condition

Listing the same stamp in the same condition twice is worth knowing about before you do it — some
marketplaces (Colnect among them) refuse the second offer outright, others simply leave you with two
competing listings. The picker points these out before you commit: an offer that already holds a
**different** copy of one of the same stamps in the same condition carries an amber
**same stamp + condition already here** marker, and the tooltip says how many of your copies it
applies to.

The warning only ever states the fact — *these copies are already offered on platform X, same stamp
and condition*. It does not claim a rule, because whether it blocks anything depends on the platform
you are listing on.

When at least one offer conflicts, the left facet panel grows a **Conflicts** group with a
**Same stamp + condition** entry and its count. Click it and the list narrows to just those offers;
clicking any **State** facet leaves it again. It appears only when something actually conflicts, so
an ordinary add never grows a facet reading zero.

It is a **warning, not a block**. The offer stays pickable and nothing is left out of the add — you
may have a reason (a deliberate re-list, a platform without the rule). Only the copies the offer
*literally* already lists are ever dropped from an add.

The **＋ Create new offer** form checks the same thing for the platform in its Platform field, and
shows an amber banner naming the offers that already hold those stamps — including their offer
numbers, so you can go and look. Switching the platform re-asks the question. Offers in every live
state count (**preparing, ready, active, paused**), so a duplicate is caught while both listings are
still drafts.

## Adding several copies to an offer at once

Every copy you still hold carries a **checkbox** on the left of its row. Tick a few and a bar
appears under the toolbar saying how many are picked, with **Clear**, [**Bulk
edit…**](#bulk-editing-the-selection), the [new-offer shortcuts](#the-new-offer-shortcuts) and
**🏷 Add selected to offer**.

A copy you [no longer hold](#copies-you-no-longer-hold) gets no checkbox — there is nothing left to
list, move or re-flag. Everything else can be ticked.

The **listing** buttons in the bar act only on the copies that can actually go into an offer —
**For sale** and **delivered** (in hand). When only some of your picked copies qualify, those
buttons say so in their number (**Add 4 to offer**, **＋ New offer · 4 sets**) and their tooltips
spell it out; when none of them do, the listing buttons are simply not shown, and the rest of the
bar works as usual.

**Add selected to offer** opens the same picker as the single-copy action, with one extra control in
the footer — **Add as**:

- **N sets** — one single-copy set each. A quantity of interchangeable singles: this is what a stock
  of duplicates is, and it is what platforms that only allow one listing per stamp and condition
  expect. This is the default.
- **One set** — a single set holding all of them, sold together. A series, or a lot.

The choice applies to **＋ New set** on an existing offer and to **＋ Create new offer** alike.
Dropping the copies into an **existing set** has no choice to make — they all go into that one set —
so the control greys out while such a destination is picked.

An offer that already lists **some** of your picked copies still works: those copies are left out and
the row says so (*"3 of 10 already listed here, and left out"*). Only an offer that already lists
**every** one of them is disabled.

The selection survives scrolling further down the list. Changing a filter clears it — what was picked
is no longer on screen.

### Conflicts in the selection bar

While the **Not offered on…** (or **Never listed on…**) filter names a platform, the bar also
answers the [one-offer-per-stamp-per-condition](#the-same-stamp-in-the-same-condition) question for
that platform: if a live offer there already lists one of the picked stamps in that condition, an
amber line says how many copies are affected, and beside it is **Add to #12 instead** — one click to
put the selection into that existing offer rather than creating a second listing for the same
stamps. The tooltip on the warning lists every conflicting offer when there is more than one.

While that warning is up, the bar's **＋ New offer** buttons and **Add selected to offer** turn amber
too — the warning is easy to read past, and those are the buttons that would create the duplicate.
They still do exactly what they say: it is a colour, not a block, and you may well know what you are
doing. They go back to normal as soon as the conflict does — when you change the selection, or use
**Add to #12 instead**.

The shortcut opens the ordinary **Add to offer** picker with that offer already picked as the
destination (as a **＋ New set** on it) **and the Same stamp + condition facet already on**, so the
list shows the conflicting offers and nothing else. You can still change your mind — drop the copies
into one of its existing sets, choose the packaging, or click a **State** facet to see every offer
again and pick a different one.

Without a platform in scope the bar says nothing about conflicts: a conflict is always a conflict on
a particular platform, and until the filter names one there is no listing being planned to warn
about.

### The new-offer shortcuts

A brand-new offer is the common quick start, so it has its own buttons in the bar, beside **Add
selected to offer**:

- **＋ New offer · one set** — creates a new offer holding all the picked copies as a single set.
- **＋ New offer · N sets** — creates a new offer with each picked copy as its own single-copy set.

They skip the picker and the **Add as** control and open the [create form](#adding-a-copy-to-an-offer)
straight away, with the packaging already decided by the button you pressed — so a fresh listing is
one click instead of three. Cancelling the form closes the dialog, the same as **Add to new offer**
on a single copy's **⋮** menu.

With a **single** copy ticked there is no packaging to decide, so the pair collapses into one
**＋ New offer** button that does the same thing.

The same checkboxes are on the copies inside an expanded [duplicate group](#grouping-duplicates), and
a group row can tick all of its copies at once — see [Listing a group's
copies](#listing-a-groups-copies).

### Quick offer mode

Listing a hundred and seventy-eight copies one at a time means a hundred and seventy-eight trips
through the create form, each asking for the same platform and the same status. **Quick offer mode**
sets those once and takes the form out of the loop.

Press **Quick offer mode** at the top of the list. A bar appears above the rows with two things in
it:

- **Platform** — which marketplace these offers are listed on.
- **Status** — what each new offer starts as: *Preparing*, *Ready* or *Active*.

From then on, every **Add to new offer** — the entry in a copy's **⋮** menu, its promoted icon on the
row, and the **New offer** buttons in the selection bar — creates the offer **straight away**, with
no dialog. The menu entry says so while the mode is on: it reads *New offer on Colnect* rather than
*Add to new offer*. The bar counts what the pass has created so far, and reports anything that failed.

The new offers carry **no asking price and no listing URL**. That is the point: the pass is about
getting the listings made, and both of those belong on the offer's own screen once the listing
exists. If you want the price filled in from the copy's catalog value, use the ordinary
[create form](#the-new-offer-shortcuts) instead — quick mode is for the bulk case.

What the offers *do* carry is whatever the platform itself says about listings on it: its **default
listing type** and, on an auction platform, its **default starting price**. Quick mode never asks
those two questions, so the platform's own answers stand — exactly as they would if you had opened
the create form and left both fields alone. Both are set on the platform's contact, under
[Platform](contacts.md).

Press **Done** (or the button at the top again) to leave. Two things to know:

- The mode is **not remembered**. It is off every time you open the list, so a click can never list
  something without asking on a screen you have just opened.
- A platform with **no currency set** cannot be used here — its currency is fixed the first time
  something is listed on it, and that choice belongs in the create form. The bar says so, and the
  ordinary dialog stays in effect until you pick a platform that has one.

## Bulk editing the selection

**Bulk edit…** in the selection bar changes **where the picked copies are kept** and **what they are
kept for**, in one dialog. It is the fast way to re-organise physical storage after a re-shuffle, or
to re-flag a batch you have just decided something about ("all of these are for trade now").

Both halves are optional and both start on **Leave as is**, so the dialog is equally the *move*
action and the *re-flag* action. Nothing you leave alone is written at all — every copy keeps
everything the dialog does not name. **Apply** stays greyed out until you have said something.

**Storage location** has three settings:

- **Leave as is** — the copies stay where they are filed. The line underneath tells you what that is
  today ("Filed across 3 locations, and 4 not filed at all").
- **Move to…** — pick a [location](locations.md) from the tree and every picked copy is filed there.
  Only locations that can hold copies are selectable, exactly as in the copy form.
- **Clear** — takes them out of storage entirely: location and ref both cleared.

While you are moving copies, a **Ref** box appears under the location. Fill it in and every picked
copy gets that ref — the card they now sit on inside the location. **Leave it blank and the refs
they carry now are cleared**, because a ref addresses a place inside the location they are leaving.

**Disposition** carries all three flags — *In collection*, *For sale*, *For trade* — each with its
own **Leave as is · On · Off**. They are independent (a copy can be in the collection, for sale and
for trade at once), so answer as many as your change needs: moving a drawer from stock to swaps is
*For trade → On* **and** *For sale → Off*, set together and applied in one go. Every flag left on
*Leave as is* is not written at all, so a mixed selection keeps whatever those flags said. Beside
each flag you answer, the dialog says how many of the picked copies are already like that.

Applying acts on every ticked copy, clears the selection (what has been dealt with should not invite
doing it twice) and confirms with a toast — worth having on this list, where a moved or re-flagged
copy often lands outside the filter you are looking through.

## Copying a catalog number

Every catalog-number chip in the app — on this list, the Stamps and Issues lists, the pickers, the
*Set catalog value* dialog — copies its number when you click it. The chip flashes green to confirm.

What lands on the clipboard is **not quite what the chip reads**: the area prefix stays and the
catalog abbreviation goes. `Mi·PL 200` copies as `PL 200`, and `Mi 200` as plain `200`. The prefix is
part of the number's identity — `Mi·PL 200` and `Mi·DE 200` are different stamps — while the
catalogue it came out of is something you already know in the box you are pasting into.

## Grouping the list

The toolbar's **grouping** select collapses the list into groups. There are four, and they answer
different questions:

- **Group duplicates** — what stock do I hold several of? (below)
- **Group by location** — what is in this box? ([Grouping by where copies are
  filed](#grouping-by-where-copies-are-filed))
- **Group by location ref** — the same, split down to the ref written on the shelf.
- **Group by issue** — what have I got of this series? ([Grouping by
  issue](#grouping-by-issue))

Only one can be in effect, and the choice is remembered per collection. Every group row works the
same way: the count leads it, the **caret** expands it into the copies underneath, and the **checkbox** in
front of it ticks all of them at once.

**Expand all** above the list opens every group at once, and reads **Collapse all** once they are
open. Opening a group loads the copies under it, so this is a real request rather than a display
toggle — on a long list it is worth pressing when you actually want to read through the copies. The
list keeps scrolling as you go, and groups that arrive after you pressed **Expand all** come in open
too. Switching to a different grouping starts collapsed again.

The copies inside an expanded group are **ordinary copy rows**, and they carry the ordinary **⋮**
menu — Edit, Add to offer, No longer held and the rest, exactly as they do with no grouping on. A
grouping decides what a copy is listed *under*; it never changes what you can do to it.

## Grouping duplicates

When you hold several identical copies, the interesting row is not the copy — it is the **stack**.
Pick **Group duplicates** and the list collapses to one row per duplicate, with its count up front
(`×10`). Expand a row (the **caret**) to see the individual copies underneath.

Two copies count as duplicates when they are the **same stamp in the same condition**. Condition is
never optional: Colnect refuses more than one offer for the same stamp in the same condition and
expects a quantity offer instead, so a group mixing conditions could not be posted.

Two further toggles appear once duplicate grouping is on, and each adds an axis to that rule:

- **Split by format** — a pair or a block becomes a different item from a single, rather than
  joining the same group. Only shown once your collection has [formats](#pairs-blocks-and-other-multiples).
- **Split by certificate** — a certified copy becomes a different item from an uncertified one. Only
  shown once your collection has certificate statuses.

Leave both off and you get the plain rule. Turn both on and each group has one unambiguous per-copy
**catalog value**, because the key is then exactly what a catalog price is recorded against. A group
whose members value differently shows *varies* instead of a figure.

Where members disagree on an axis you left off, the row says so — **mixed formats**, **mixed
certificates**. With that axis switched on, the marking cannot appear: the copies are in different
groups.

Grouping and filtering are **different questions** and both apply. The sidebar and toolbar filters
decide *which copies you are looking at*; the toggles decide *what counts as the same item*. On top
of that, grouping only ever covers copies you can still list — **For sale**, **delivered**, and
unsold — so the *Include sold & traded* and delivery-state controls grey out while it is on, and the sort
control is replaced: groups are ordered by **how many copies each holds**, largest first.

Each toggle is remembered per collection, so the list opens the way you left it.

### Listing a group's copies

A group is a way of *reading* your stock, so listing its copies uses the one flow every other
selection uses — the [checkboxes and the **🏷 Add selected to offer**
bar](#adding-several-copies-to-an-offer-at-once). Expand a group and its copies carry exactly those
checkboxes.

For the common case there is a shortcut: the **checkbox in front of the group row** opens the group
and ticks its copies in one click. Untick it to let them go again. It shows a dash while only some of
the group's copies are ticked. Selections from several groups add up, so you can tick two stacks and
deal with them together.

Copies that **differ from the rest of the group** on an axis you left off are highlighted with a
*differs from the group* mark and are **left out of Select all** — tick them by hand if you do want
them. The odd one out is worked out from what the majority actually is: in a stock of ten certified
blocks and one plain single, the single is the exception, not the blocks.

From there it is the ordinary bar: **🏷 Add selected to offer**, whose **Add as** control decides
between **one single-copy set each** (a quantity of duplicates — what platforms that allow one
listing per stamp and condition expect) and **one set holding all** of them. When the destination is a
new offer anyway, the [new-offer shortcuts](#the-new-offer-shortcuts) in the same bar make that
choice by themselves.

Which copies are still free to list **on a given platform** is what the **Not offered on…** filter
answers — set it first and the whole screen becomes that platform's worklist, and the platform is
pre-filled into the offer form for you.

The group row also reports how many of its copies are **already listed** somewhere, on any platform.

## Grouping by where copies are filed

**Group by location** collapses the list to one row per [storage location](locations.md), over the
copies filed there — so a klaser is one row, with its count, and expanding it lists what is in it.
**Group by location ref** goes one level finer and splits each location by the **ref** written on
the copies (`A234`), in shelf order: prefix first, then the number, so `A2` comes before `A10`.

A few things worth knowing:

- A location counts **only what is filed in it**, never what is in the boxes under it. A cupboard
  holding two klasers is its own row for the copies put straight into the cupboard, and each klaser
  is a row of its own. (To read a whole branch as one set, use the location filter with its
  *include sub-locations* scope instead.)
- Copies **filed nowhere** are the last row, and copies with **no ref** are the last row within their
  location. There is nothing to walk to, so they sort last.
- Unlike duplicate grouping, this covers **whatever the list is showing**. Every filter still applies
  — including *Include sold & traded* and *Include no longer held* — because "where is it?" is a fair question
  about a copy you have already sold but not yet posted.
- The **checkbox** in front of a group row ticks the copies filed there that can be listed (for sale
  and in hand), exactly as it does on a duplicate group.

Both groupings are computed on the server, so a group is never split in half by scrolling.

## Grouping by issue

**Group by issue** collapses the list to one row per [issue](collections.md), over the copies you
hold of it — the reading you work a series through, and the one that shows at a glance where a set is
thin. Rows are in the **Issues list's own order**: by year, then by the issue's primary catalog
number, then by name. An issue with no year comes after the dated ones, and the copies whose stamp
belongs to **no issue** are the last row of all.

Like the filing groupings and unlike duplicate grouping, this covers **whatever the list is
showing** — every filter still applies, *Include sold & traded* and *Include no longer held* among them,
because "what have I got of this set" includes the piece you have already sold. The **checkbox** in
front of a group row ticks the copies of that issue that can be listed, and the grouping is computed
on the server, so a group is never split in half by scrolling.

A stamp can belong to more than one issue. A copy is counted under **one** of them — the first issue
its stamp was added to — so the counts add up to the list exactly rather than reporting one copy
under two series.

### How complete each set is

Under the issue's name, the group header says how far its [checklists](collections.md) have got,
**condition by condition** — `MNH 3/5`, `U 5/5`, one chip per condition you hold something of. A
condition you own the whole set in is tinted green. Conditions you hold none of get no chip at all:
the ones on the line are the ones there is something to say about.

Hover a chip for the full sentence — which checklist it is talking about, the condition spelled out,
and **how many complete sets** you could assemble from those copies (the figure that says whether a
duplicate is a spare or the only one you have).

These figures are counted over **the copies this list is showing**. Every filter in force applies, so
a list narrowed to one klaser tells you how complete the set is *in that klaser* — not how complete
it is across the collection. That is deliberate: a header describes the rows underneath it. Clear the
filters to read the whole collection's answer, or open the issue's own page for the full
[completeness grid](detail-pages.md#completeness), which breaks the same question down by disposition and format
as well.

A copy filed under a **variant** of a stamp on the checklist counts for that stamp, at any depth —
the same rule the issue's own [completeness grid](detail-pages.md#completeness) states in full.

An issue whose checklists you hold nothing of shows no chips, and so does the **no issue** row: a
bucket of copies is not a set that can be complete.

## Seeing what a stamp is worth

Every copy row's **⋮** menu has a **Show valuation** action. It opens the read-only **Valuation**
dialog for the stamp this copy is of — what the market has paid for it, what you have paid for the
copies you hold, and what the catalogs list it at. It is the same window the **Stamps** and
**Issues** lists open, and it changes nothing: close it and you are back on the list, in the same
place. See [The Valuation dialog](collections.md#the-valuation-dialog).

This is not **Edit stamp**, which is on the same menu and opens the stamp *editor* — use that one
when you want to record a catalog value rather than read one.

## Seeing which offers something is in

Every copy row's **⋮** menu has a **View offers** action. It opens a read-only popup listing
**every offer that references this copy**, across all platforms and all states — live listings
first (**Active**, **Paused**), then the ones you're still preparing, then the closed ones
(**Sold**, **Withdrawn**). A copy you have never listed says so.

The same action is on the **Stamps** and **Issues** lists, next to
[View copies](#viewing-copies-from-the-catalog) and scoped the same way:

- On a **stamp** row — and on each stamp inside an expanded issue — it lists every offer holding a
  copy of *that stamp*. Like the [copies-held badge](collections.md), it counts the stamp
  **exactly**: a variant child's listings are on the child's own row, one line down, so nothing is
  reported twice.
- On an **issue** row, it lists every offer holding a copy of *any* stamp in that issue — what the
  whole issue currently has on sale.

Each row shows the offer's title, its **platform**, its **state**, the number of sets when it
holds more than one, and its **asking price** (with the base-currency equivalent when the offer is
in another currency). The same **Needs action** and **In bidding** badges you see on the
[Offers](offers.md) list appear here too.

- Click a row to open that offer's detail screen.
- Click the **Listing** chip to open the listing on the platform itself, when you have recorded
  its URL.
- Closing the popup returns you to the list you opened it from, right where you were.

The action is always available — including for copies that have already sold, so a piece's past
listings stay reachable.

## Photos

Attach photos to a copy from the **Photos** section at the bottom of the add-copy and
edit-copy dialog. Because purchase-order intake uses the same dialog to identify copies into
a lot, you can photograph stamps as you receive them — see
[Purchases](purchases.md).

There are two kinds of slot:

- **Front** and **Back** are dedicated single-image slots. Drop a file on a slot or click it
  to pick one. Re-uploading **replaces** the current image; the **✕** on a slot clears it.
- **Additional photos** are unlimited extras, each with an optional **title**. Add them by
  dropping files on the **＋ Add photos** area or clicking it. Drag the **⠿** handle to
  reorder them, edit a title inline, and use **✕** to remove one.

When a copy has **no photos yet**, the **＋ Add photos** area expands to fill the whole
space reserved for photos, giving you one large, easy target to drop the first files onto.
Once at least one photo is attached, the strip of photo cards returns above a normal-sized
add-photos area.

Accepted formats are **JPEG, PNG, and WebP**, up to **200 MB** each. Each photo is
automatically downscaled for storage and given a thumbnail for the list and slot views.

Thumbnails everywhere in the app show the **whole** image, scaled to fit inside the thumbnail box by
its longest edge — never cropped to fill the box. A tall stamp leaves a little space at the sides, a
wide one above and below, and nothing of the stamp itself is cut off.

**Rest the pointer on any thumbnail** and an enlarged preview of that photo opens beside it, with
the photo's label underneath. It appears after a short pause, so running the pointer across a list
of thumbnails on the way somewhere else pops nothing up. This works wherever thumbnails are shown —
copy and stamp rows, the read-only photo strip, an offer's photos and its attachment picker, the
listing workspace, and the scan tiles of a purchase. Clicking still opens the full-size lightbox;
the preview is for a quick look without leaving the list.

Photos upload **as soon as you drop them** — each thumbnail shows its own upload progress bar,
and an overall bar above the strip tracks all in-flight uploads together — but nothing is
attached to the copy until you **Save** the dialog. The Save button waits while an upload is
still in progress. If you **Cancel** or close the dialog instead, the
staged uploads are discarded and never attached.

Saved photos appear as a single thumbnail at the left of the copy's row and in the read-only
[View copies](#viewing-copies-from-the-catalog) popup. When there is more than one photo, a
counter and **‹ / ›** controls let you step through them without leaving the list; front and
back are marked with an **F** / **B** corner badge. Click the thumbnail to view the photo
full-size.

When a copy gets its **front** photo and its linked stamp has **no photo yet**, that front is
**automatically promoted** to the stamp as its `main` reference image (an independent duplicate
— the copy keeps its own). This seeds the catalog stamp's picture from the first copy you
photograph; the next copy of the same stamp sees a picture already there and is left alone. You
can also **promote** any saved copy photo to the copy's stamp by hand. See
[Collections → Stamp photos](collections.md#stamp-photos).

Promotion also propagates **up the variant tree**: ancestors of the stamp that have no photo yet
get one too, stopping at the first ancestor that already has a picture — and only while each step
up is a **variant** of the stamp above it (a colour, perforation, paper or watermark difference),
never from an error, plate flaw or overprint.

The **automatic** promotion only happens for copies with **no format** set, that is single stamps.
A copy recorded as a pair, block or strip shows a multiple rather than the single catalog stamp,
so it is never chosen on its own as the stamp's reference image. Promoting **by hand** stays
available on every copy — if a block's photo is the picture you want on the stamp, use the **⬆**
button and it is used.

## Identifying a variant

When you record a copy against a **base stamp** because you don't yet know its exact
variant, the copy is flagged **unknown variant**. Once you work out which variant it
actually is, resolve it:

1. On an unknown-variant row, open the **⋮** menu and choose **Identify variant**.
2. Pick the specific variant from the list — only the variants of that copy's own stamp
   are offered, so you can only refine to a *more specific* variant, never re-point the
   copy to an unrelated stamp.
3. Optionally add a **reason** (for example, what let you tell the variants apart).
4. Click **Identify variant**. The copy is re-pointed to the chosen variant, the
   *unknown variant* flag clears, and the change is recorded in the copy's refinement
   history.

## Refinement history

Every time a copy is re-pointed to a different variant — whether through **Identify
variant** or by changing the stamp in **Edit** — the change is appended to that copy's
**refinement history**: what it was, what it became, when, and any reason you noted. Any
copy that has been refined offers a **View history** action in its **⋮** menu; choose it
to see the full trail.
The trail is never erased, so a copy's identification path stays traceable even after the
variant is settled.

## Deleting a copy

Open the row's **⋮** menu and choose **Delete**, then confirm. This permanently removes
that physical copy record, along with any photos attached to it, and cannot be undone.
