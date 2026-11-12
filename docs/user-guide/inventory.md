# Inventory

Your **inventory** is the physical copies you own. A **copy** is a single physical stamp:
each copy is its own record, so two copies of the same stamp can differ in condition,
certificate, disposition, storage, and notes. There is no "quantity" — three
copies of the same stamp are three rows.

Open the **Inventory** screen from **Collection → Inventory** in the sidebar.

Each copy also has a page of its own, gathering everything about it — including its purchase, its
offers and the sale it left on — in one place. Open it from the row's **⋮** menu with **Open copy
page**; see [Detail pages](detail-pages.md).

## The inventory list

Each row shows:

- The copy's **internal number** (e.g. `#123`) — see [Internal copy number](#internal-copy-number).
- The linked stamp's **catalog number**, **name**, and **issue**.
- The **condition** and any **certificate status**, each in the colour you gave it (see
  [Condition and certificate colours](collections.md#condition-and-certificate-colours)).
- **Disposition** markers — *In collection*, *For sale*, *For trade* — a copy can carry
  any combination at once. Copies you intend to sell are composed into [offers](offers.md).
  Each has its own colour wherever it appears — *In collection* green, *For sale* blue,
  *For trade* violet — on the rows, the filters, the copy page, the Overview and the held-copies
  lines. Where you choose a disposition (adding or identifying a copy, the run, storing a lot), the
  ones you picked take their colour and the others stay grey.
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

Your filters are **remembered per collection**: come back to the list tomorrow and it opens narrowed
the way you left it — condition, format, certificate, delivery state, location, the disposition
filter, the several-stamps filter, the **Complete** and **Held** filters and every **More filters** switch, alongside the grouping mode and sort that were
already remembered. Switching a filter off is remembered too, so
clearing one clears it for next time. A link that names a filter still wins over what is remembered,
so a shared or bookmarked list keeps meaning what it meant. The **search box** is the exception: it
is never remembered, so you are never greeted by a list narrowed to a phrase you have forgotten
typing.

To keep a combination of filters, sort and grouping you come back to — *PRL, for sale on Colnect,
\*\* only, grouped by issue* — save it as a **preset** and bring it back in one click: see
[Filter presets](filter-presets.md).

The **area** and the **year** are shared with the Issues, Stamps and Wants lists, so arriving from
one of those opens this one on the same country and year. When that happens the address bar is
brought up to date with it, exactly as if you had picked them here — so refreshing the page keeps
the filter, the back button steps through the selections you actually made, and the address can be
copied to another window and show the same list. A list you have not narrowed keeps a plain
address.

If a link names an area you have since deleted, the list opens on **All areas** rather than on an
empty screen, and the address is corrected to say so.

The toolbar **stays pinned to the top of the window** as you scroll a long list, so search,
sorting and the filter chips are always in reach — on every list that has one: Issues,
Stamps, Copies, Offers, Sales and Purchases.

The screen's actions — **Quick offer mode** and **Add copy** — sit at the
**right-hand end of that same toolbar row**, the way the [Offers](offers.md) screen arranges its
own. They used to stand in the header above it, which made using a filter and then an action a trip
across the window. Nothing about what they do has changed. On a narrow window the filters wrap onto
further lines first and the actions stay put on the right; only when even that runs out do they
drop to a line of their own, still right-aligned.

**Using a filter never moves the filter bar.** Each control keeps the same width whatever is picked
in it — a long value is shortened with an ellipsis rather than allowed to stretch the control — and
nothing appears or disappears from the row as you narrow the list. The bar is therefore a little
wider at rest than a bar sized to its current labels would be, and in exchange it never reflows
under your pointer while you are working it. The only controls that come and go are the ones for an
axis your collection does not use at all: with no formats defined there is no format filter, with no
storage locations there is no location filter or filing grouping.

**A filter that is narrowing the list is drawn in the accent colour** — the location filter with a
location (or *Not filed*) chosen as much as a delivery state or *No photos* ticked. A control back
on its *All …* / *Any …* value returns to the resting look, so a glance at the bar shows everything
that is filtering the list.

**Reset filters** at the end of the filter row puts the whole screen back to an unfiltered list in
one click: every filter on it — condition, delivery state, disposition, format, subtype, certificate,
location, several stamps, every **More filters** switch, the *Not offered on…* worklist — and the search box and the issue filter, though not the fields beside the box that it
searches. It clears what is remembered as well, so the
list comes back unfiltered next time too. It is only there to click while something is actually
filtering, but its place on the row is held either way, so the first filter you switch on does not
shunt the rest of the bar sideways.
The **area** and the **year** are deliberately left as they are — those two are shared with the
Stamps and Wants lists, and a reset here that quietly re-shaped those screens would be doing more
than it says. Clear them from the area panel (**All areas**) and the year panel.

- **Area** — the panel on the left lists your collection's [areas](collections.md) as a
  tree. Pick one to show only copies whose linked stamp belongs to that area; selecting an
  area includes its nested sub-areas. Choose **All areas** to clear it — clicking the area you
  already have selected does nothing, so a stray second click cannot silently widen the list back
  to everything. Each area carries a **count** of the copies selecting it would show, counted
  against everything else on the screen — the search box, the year, the toolbar filters — but not
  against the area filter itself, so the number always says what clicking it would give you. Areas
  with nothing in them show **0** rather than an empty space. A copy whose stamp is filed in two
  areas is counted under both, so the counts down the panel can add up to more than the list holds
  — that is the same copy seen from two places, not two copies.
  Once you pick an area that *has* sub-areas, a small **+ sub-areas / this area only** switch
  appears above the tree. **+ sub-areas** is the default and the usual way to browse; **this
  area only** narrows the list to what sits directly on the area you picked, which is how you
  find pieces that were never filed into a sub-area. The switch is remembered, and it applies to
  every list with an area panel — Issues, Stamps, Copies and the stamp picker — so they always
  agree about what an area selection means. The counts follow it: with **+ sub-areas** a parent
  shows its whole subtree, with **this area only** just what is filed on it directly.
  Under **All areas**, **No area** lists the copies whose stamp is filed in no area at all. It is
  there only while you have some — or while it is the filter in force.
- **Year** — the panel beside the areas lists the years your copies' stamps were issued in; pick one
  to show only those copies, or **No year** for stamps with none. A link from the
  [collection structure](overview.md#collection-structure) screen can narrow the list to a whole
  **decade** instead: the year panel then shows the span, *1950–1959*, as the selection under
  **All years**. Clicking **All years** or any single year replaces it. The decade is not remembered
  for your next visit the way the year is.

The rest sit in the toolbar, and they are listed here in the order they appear on it — left to
right, from *which copies* to *how they are shown*.

- **Search** — type in the search box to match copies by the linked stamp's **name**, its
  **issue name**, a **catalog number**, or the copy's own **location ref** (case-insensitive).
  A catalog number can be typed bare (`200`) or with its full prefix and any spacing
  (`Mi PL 200`, `MiPL200`); when the text starts with a known vendor abbreviation the match is
  narrowed to that vendor. Typing a shelf reference such as `A234` finds the copies filed under
  it, so you can go from a piece in hand straight to its record. A plain number also looks up an
  **internal copy number** — `123` and `00123` find copy `#123` — alongside the text matches, so a
  number that is also a catalog number still finds both. Written with the **`#`**, as the box's
  placeholder reminds you, it is the copy's number and nothing else: `#123` lists **only** copy
  `#123`, and `#00123` finds it too. The filters still apply to it; when they hide that copy, the
  empty list says so, with **Show it** to clear every filter — the area and the year included — and,
  for a copy that was sold, traded away or written off, to switch on the *Include* that shows it.
  When the collection has no such copy, the list says that instead.

  **Beside the box, a control picks which fields it searches**: *Stamp name*, *Issue name*,
  *Catalogue number*, *Location ref* and *Copy number*. All are ticked to begin with, and the
  control reads **All fields**; untick the ones you do not mean and the box matches only what is
  left — with only *Location ref* ticked, `A038` finds the copies filed under `A038` and not a
  stamp or catalogue number that happens to contain the same characters. **All fields** at the top
  of its list ticks them all again. One field always stays ticked. While the search is narrowed the
  control is drawn in the accent colour and names the one field ticked, or how many are
  (*2 fields*), so a search that finds nothing because of it shows why at a glance. `#123` is still
  the copy's number whatever is ticked, and a catalogue number typed with a vendor prefix is still
  narrowed to that vendor within *Catalogue number*. The choice is remembered for this list in each
  collection, and **Reset filters** leaves it as it is: it is how the box reads what you type, not a
  filter on the copies. Other ways into the same search — the copy pickers and quick-jump — keep
  searching every field.
- **Issue** — a copy's row has **Show this issue's copies** (the issue icon beside the offer
  icons, and in its **⋮** menu) to list every copy of the same issue — the way to gather the rest
  of a set once a search has found one of its stamps. The search is cleared and the issue takes its
  place; every other filter keeps narrowing, so with *For sale* and a condition ticked the list
  shows the copies of that issue that can go into the offer. Copies already ticked stay ticked, so
  the one you started from can be joined by its siblings in a single selection, and the list keeps
  its sort and grouping. The issue shows as a chip above the list, with its name and year;
  **×** on the chip or **Reset filters** removes it. A stamp filed in more than one issue, and a
  piece carrying several stamps, offers the action once per issue — the menu names each one. While
  the issue filter is set it wins over the **area** and **year** panels, which are left as they
  were. It is kept in the page address, so the list survives a reload and can be linked, but like
  the search it is not remembered once removed.
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
- **Delivery state** — show only copies in the delivery states you tick. Like the condition filter
  it takes **several at once**, which is how you ask the question that actually comes up: ticking
  *Ordered*, *In transit* and *To sort* together is "everything still on its way to me". Or tick one
  — every copy marked *Damaged*. See [Delivery state](#delivery-state).
- **Disposition** — tick *In collection*, *For sale*, and *For trade*. With none ticked, all copies
  are shown. These three are **marks a copy can carry at once**, not three kinds of copy, so ticking
  two narrows to the copies carrying **both** — the control says so on hover. (It used to be three
  separate buttons; it is one dropdown now, and it filters exactly as it did.)
- **Condition** — show only copies in the conditions you tick. It takes **several at once**: click
  it and tick as many grades as you like, and the list shows copies in *any* of them — "the mint
  grades" is as ordinary a question as one grade is. **No condition**, at the top, finds the
  [covers and other pieces](#a-piece-has-no-condition), which have none, so filtering by condition
  never hides them for good. The control reads the grade's name when one is
  ticked and counts them when more are (`3 conditions`); **All conditions** at the top of the list
  clears it. Everything that follows the list follows this filter too — the year panel, the holdings
  totals, and the grouped views.
- **Certificate** — show only copies carrying the certificate statuses you tick, **No certificate**
  among them: a copy having none is an answer, not the absence of the question, so you can ask for
  the uncertified pieces on their own or for "certified *or* not yet certified" together. Like the
  format filter it appears only once your collection defines certificate statuses.
- **Format** — see [Filtering the list by format](#filtering-the-list-by-format). It appears only
  once your collection defines formats.
- **Subtype** — show only copies of stamps carrying the [subtypes](collections.md) you tick —
  *Error*, *Overprint*, *Forgery* and the rest — with **No subtype** among them for the copies of a
  base stamp, which has none. Since this list is where offers are made, it is how you keep forgeries
  out of what you are about to list: tick everything **except** *Forgery*, **No subtype** included,
  and they are gone from the list and from anything you select on it. Tick only *Forgery* when you
  mean to sell them deliberately. It reads the copy's own stamp; a cover carrying several stamps
  answers for the first of them. Like the filters beside it, it is remembered between visits and the
  year panel, the area panel and the holdings totals follow it.
- **Issue format** — show only copies of stamps issued as the [issue formats](collections.md#filtering-by-issue-format)
  you tick — *Souvenir sheet*, *Booklet pane* and the rest — with **Stamp (none)** among them for the
  ordinary stamps. Unlike the subtype, a cover carrying several stamps matches when **any** of them
  does. Always on the bar, since every collection starts with the list.
- **Several stamps** — *Any number of stamps* (the default), *Only several-stamp pieces* or *No
  several-stamp pieces*: narrow the list to the [covers and other pieces carrying several
  stamps](#covers-fragments-and-other-pieces-carrying-several-stamps), or set them aside. It is
  always on the bar, whether or not you have entered such a piece yet.
- **Complete** — *All, complete or not* (the default), *Complete — any condition*, *Complete — one
  condition* or *Incomplete*: show only the copies of issues whose set you hold whole, or of those
  you do not, so the series you can offer complete are not found by scrolling past every unfinished
  one. *Any condition* means the [Any chip](#how-complete-each-set-is) reads in full — MNH and MH
  together count; *one condition* means one condition's own chip does. *Incomplete* is every other
  issue that has chips. An issue with no chips — no checklist, nothing held of it, or the copies with
  no issue at all — is left out by every choice but the default, and so are the pieces carrying
  several stamps. Where an issue has more than one checklist, any one of them being complete makes
  the issue complete. The judgement is made over **the copies the other filters let through** —
  exactly what the chips count — so narrowed to one klaser it keeps the series complete *in that
  klaser*, and what it keeps always agrees with the chips on screen. It works whether or not the
  list is [grouped by issue](#grouping-by-issue); ungrouped, you get the copies those groups would
  hold. Specialised checklists count only while they are switched on, as they do for the chips.
- **Held** — *Held any number of times* (the default), *Held once* or *Held more than once*: show
  only the copies of stamps you hold a single copy of, or of those you hold several of, so the
  stacks are not found by scrolling past every `×1`. It counts exactly as
  [Group duplicates](#grouping-duplicates) does: while the list is grouped that way, *More than
  once* keeps precisely the rows whose count is `×2` or more, and the **Split by …** switches you
  have on decide what one stack is — split by condition, two MNH copies and one MH copy of a stamp
  are a stack of two and a single. Under any other grouping, or none, the switches do not apply and
  a stack is every copy of one stamp; ungrouped, *More than once* keeps each of those copies. The
  count is made over **the copies the other filters let through** — narrowed to MH, a stamp held
  twice in MNH and once in MH is held once — but a group you open keeps exactly what the list
  kept: a stamp held once in this klaser and once in another is held twice in both klasers' groups.
  A piece carrying several stamps is in no stack, so only the default shows it. Together with
  **Complete**, it answers *which series do I hold whole in duplicate?*: the completeness is judged
  over the copies *Held* kept.
- **Tags** — show only copies carrying the [tags](tags.md) you tick. Inside its panel is a **Must
  carry every ticked tag** switch: off (the default) the list shows copies carrying *any* of the
  ticked tags, on it shows only the copies carrying *all* of them, and the closed control says which
  reading is in force — *Any of 2 tags* or *All of 2 tags*. With one tag ticked the switch has
  nothing to say and is greyed out. These are the **copy's own** tags: a tag on the stamp a copy is
  linked to is not on the copy, so it will not bring the copy into this list. **No tags**, at the top
  of the panel, shows the copies carrying no tag at all; ticked beside some tags, it shows those
  copies as well. The filter appears only
  once your collection defines tags, and it is remembered between visits like the ones beside it.
- **Faults** — show only copies carrying **any** of the [faults](faults.md) you tick. **No faults**,
  at the top of the panel, shows the copies with no fault at all; ticked beside some faults, it shows
  those copies as well. Remembered between visits like the ones beside it.
- **Location** — show only copies stored in a chosen [location](locations.md). Selecting a
  location includes copies in every location nested inside it, so filtering by a cabinet
  shows the copies in all of its stockbooks at once. A **+ sub-locations / this location only**
  switch sits **at the foot of the location dropdown** — *this location only* answers "what is
  loose in the cabinet itself". It is there whenever the dropdown is open, before you have picked
  anything, so you can see how the filter is going to read; it lives inside the dropdown because it
  says nothing on its own, only qualifying the location you pick.
  The dropdown **stays open when you pick a location**, so you can pick and then set the scope
  without reopening it — the list behind it updates as you go. Press Escape or click outside to
  close it. Like the area one, the switch is remembered, and the holdings totals and year panel
  follow the filter. **Not filed**, just under *All locations*, shows the copies with no location.
- **More filters** — the occasional switches, in one dropdown under two headings, because **some of
  them narrow the list and two widen it**:
  - *Show only* — **No photos** shows only copies with no [photo](#photos) attached, so you can
    find the pieces still waiting to be photographed; **With photos** is its opposite — only the
    copies that have a photo, so [offers generated](offers.md) from the list are made only from
    copies with a picture, leaving the rest for later. The two exclude each other: ticking one
    unticks the other. **Missing catalog value** shows only copies
    with no catalog value recorded for their condition (those showing **—**), so you can fill
    pricing gaps in bulk — it pairs with the **+ catalog value** price link below. **Not on any open
    offer** shows only copies that are on no open offer on any platform — the ones to prefer when
    you put an offer or a [proposal](offers.md) together, because one picked from them never has to
    be closed somewhere else when it sells. Open means anything but sold or withdrawn, so a copy in
    an offer you are still preparing counts as offered. Beside the **Not offered on…** worklist it
    leaves that one nothing to add about offers, and the worklist's dropdown says so — drawn with a
    dashed border instead of the accent — while still keeping to the copies for sale and not kept
    off that platform. Tick several and a copy must satisfy every one.
  - *Also include* — **Include sold & traded** brings back copies that have [sold](sales.md) and
    copies you gave to a partner in a closed [trade](trades.md), both hidden by default so the list
    shows only what you still hold; each then carries a **Sold · #12 · 2026-10-03** or **Traded
    away · #7 · Anna** chip, linking to the sale or the trade, so a copy that has left is never
    mistaken for one still in it, and where it went is one click away. **Include no longer held** brings back
    copies marked as [no longer held](#copies-you-no-longer-hold), hidden for the same reason.
  - So ticking one from each heading reads as one sentence: *No photos* + *Include sold & traded* is
    "copies with no photo, counting the ones that have sold". The holdings totals and year panel
    follow every one; the totals always account for no-longer-held copies, on their own **Written
    off** line.
- **Grouping** — a dropdown that also holds duplicate grouping's three **Split by …** switches. See
  [Grouping the list](#grouping-the-list).
- **Sort** — by **date added**, **catalog number**, **issue date**, **stamp name**, **issue name**,
  **copy number**, **catalog value** or **cost**, each ascending or descending with the arrow beside
  it. Picking a sort starts it the useful way round — the catalogue keys and copy number ascending,
  date added and the two values newest or dearest first.
  - The catalogue keys read as on the Stamps list: catalog numbers the way the catalogue arranges them
    (*2* before *10*, a variant such as *200a* right after *200*), and the issue date by year, month
    and day. A copy of several stamps (a cover, a fragment) sorts by its first stamp.
  - **Catalog value** and **cost** are the figures the row shows: the copy's own catalog value, and
    its cost — the frozen cost, or while its purchase lot is still open the **~** estimate. Copies
    with no value, no cost, no catalog number, no issue date or no issue come **last** either way.
  - Copies equal on the chosen sort follow by catalog number, then by copy number.
  - The whole list is sorted, not just the rows loaded so far, under every filter.
  - Under **Group by location**, **location ref** or **issue** the groups keep their own order and
    the sort orders the copies inside each group. Under **duplicate** grouping it is greyed: its
    groups are ordered by how many copies each holds, and a group's copies are of one stamp. Hover
    it and it says so.

The holdings summary totals follow whatever the filters are showing, so a filtered view
tells you the catalog value and purchase cost of just those copies.

## The want marker

A copy whose stamp is on your [want list](wants.md) carries a **crosshair chip**. Click it for
every open want on that stamp; the chip is **ringed** when this copy's own condition, certificate
and format would satisfy one.

Holding a copy never closes a want, so on this list the chip is usually the **upgrade** signal: you
have one, and you are still after a better one. A grouped row carries it too — a group is one stamp
at one condition, so the answer covers every copy in it.

A piece carrying **several stamps** never carries the chip, even when one of its stamps is wanted: it
would satisfy none of those wants, and you do not hold one of those stamps by holding it.

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

### Lowering a copy's value for its faults

A faulty stamp is worth less than the catalog says. Type by how much in the copy's **Value
reduction** field, beside its [faults](faults.md) in the copy dialog — a whole percentage from 1 to
100; leave it empty for none. It can be set on a copy with no listed faults too.

The reduction lowers **every value of that copy**: its catalog value (or the value
[computed for a cover or other piece](#what-a-piece-carrying-several-stamps-is-worth)), its market value, and every total and suggestion built from them —
the holdings bar, the Overview, the offer's suggested price, a purchase's percentage of catalog, the
lot builder and your own valuation of a trade line. The stamp's catalog price is not changed; only
this copy's figure is.

A lowered figure says so: the value carries an amber **−40 %**, and its hover names the full figure
(*full 45.00 EUR, −40 % for faults*). A total that includes lowered copies says how many, and its
hover gives the total without the reductions. The figure you agreed with a trade partner from their
catalog is not lowered — adjust that line with its own value if the faults should count there.

### Adjusting a copy's catalog value

Catalogs carry exceptions a price grid cannot hold: a surcharge for a particular cancellation
(*+200 %*), a premium for a rare usage, a fixed addition for a feature. Record one on the copy with
the **Value modifier** row of the copy dialog, under the faults and their reduction — or where the
value is being worked out: while
[identifying a scan tile](purchases.md#marking-the-condition-before-identifying), and in a piece's
[Valuation window](#what-a-piece-carrying-several-stamps-is-worth), beside the value it adjusts.
Most copies never take one, so everywhere it is **folded to one line**, **▸ Value modifier**: click it
to open the fields. A modifier that is set is named on that line — *Value modifier +200 % · Stempel
Danzig* — so it is never hidden, and a copy that has one opens with the fields showing:

- **Value modifier** — a whole percentage, positive or negative, from −100 up;
- **Amount** — added after the percentage, and may be negative. It is in the **currency of the
  copy's catalog value** — the catalog the copy is valued from — and is converted with it, so
  *+200 € in Michel* stays what the catalog said;
- **Modifier note** — why, for example *Stempel Danzig +200 %*, shown wherever the modifier is so the
  figure can be checked against the catalog.

Leave both figures empty for none. The copy is valued at **catalog value × (1 + percentage) +
amount**, never below zero, and only then lowered by its
[value reduction for faults](#lowering-a-copys-value-for-its-faults). A copy with no catalog value
gets no value from the modifier alone: an amount is nothing without the catalog figure it adjusts.
On a cover or another piece, the modifier adjusts the value computed for it, and its amount is in your
collection currency, which that value is computed in.

Everything that reads the copy's value reads the modified one — the Copies list and its total, the
Overview, an offer's suggested price, a purchase's percentage of catalog, the lot builder and your
own valuation of a trade line. The stamp's catalog price is not changed, and neither is its market
value: auction results describe the stamp, not this piece's exception. The figure you agreed with a
trade partner from their catalog is not modified either, since the amount is stated in your
catalog's currency.

A modified figure says so: the value carries a blue **+200 %** (or the amount), and its hover names
the catalog figure, the modifier and its note (*Catalogue 10.00 EUR, +200 % (Stempel Danzig)*). The
copy's own page shows the modifier, its note and the catalog figure under **Value modifier**, and the
result under **Catalog value**.

Above the list, the holdings summary bar sums three figures over every copy that matches your
current filters (change the filters and all of them follow).

It is **collapsed to one line by default**, the way the [Offers](offers.md) summary is: the catalog
value, how many copies the current filter holds, and a **More** button. Press it and the rest of
the figures appear; the choice is remembered per collection, so a bar you open stays open on your
next visit. Collapsing is the default because a block of figures between you and the list is
something to read past on every visit, while most of what it can say is a question you ask
occasionally.

- **Catalog value** — the headline, on the collapsed line. What your holdings are worth, as
  described above. It also tells you **how many copies are on the list** — the count of the whole
  filtered set, not just the rows loaded so far, and not changed by
  [grouping](#grouping-the-list), which decides what a *row* is rather than which copies are in
  scope. Beside that it says how much of the total is uncertain (unknown-variant estimates) and how
  many copies are unpriced or could not be converted.
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
  per-copy cost-basis distinguishes them. Copies from an
  [opening balance](purchases.md#opening-balances) are never in it: nothing was paid for them.
- **Opening value** — shown only when some of the copies came in on an opening balance: what their
  lots were stated to be worth, split across the copies the same way. It counts towards profit and
  loss when they sell, but it is not money spent, so it has its own line. Copies whose lot has no
  opening value are counted beside it as *without a value*.

Comparing the lines shows list price, what the market pays and what you paid, side by side. What
you **paid** is ruled off from what the copies are **worth** and labelled *Cost accounted to
copies*, because the two answer different questions and reading them as one list means working that
out afresh each time.

**A figure with nothing behind it is not shown as an amount.** Every one of these figures is a sum
over a set of copies, and where no copy contributes there is nothing to sum — so the line says *not
worked out yet* rather than printing `0.00`, which would state that your copies are worth nothing
and cost nothing. That happens more often than it sounds: a market value with no auction results
recorded anywhere, a purchase cost where every lot is still open. The grey sentence beside the line
still counts exactly what is missing.

A figure built from **part** of the copies is still shown, and the sentence beside it says how much
is missing — a partial answer is useful as long as it is not passed off as a complete one. And a
figure that genuinely comes to nothing still reads `0.00`: copies that are all priced at zero are a
different statement from copies nobody has valued, and the line makes both.

A figure that **cannot** apply says so too. A copy from an opening-balance lot with no opening value
has no cost at all, and never will, so when every copy behind a cost line is one of those the line
reads *not applicable* — not *not worked out yet*, which would promise a figure that is not coming.

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
- ***~4.00 EUR*** — the copy belongs to a purchase lot that is still **open**, so its cost-basis
  is not settled yet; this is its **estimated** cost, the same figure its purchase order shows: its
  share of the lot's cost by catalog value. The `~` and the muted italics mark it as an estimate. It
  becomes the cost-basis when you close the lot (see [Closing a lot](purchases.md#closing-a-lot)),
  and no total counts it in the meantime — a total still counts the copy as *pending*.
- **cost pending** — the copy is on an open lot, but no estimate can be made: it has no catalog
  value to share the lot's cost by, its purchase has no exchange rate to your base currency, or it
  was marked *not delivered* and so leaves the split. Hover it for which.
- *nothing* — the copy has no cost-basis: you added it by hand rather than through a
  purchase, or it was marked *not delivered* and dropped from its lot.

A frozen cost-basis is **not** recomputed automatically if you later edit catalog prices
or re-point the copy to another variant — to change it, reopen the lot, correct the copies,
and close it again.

### What a sold copy earned

Once a copy has [sold](sales.md), the **Sale** card on its [copy page](detail-pages.md#the-copy-page)
shows three figures, all in your base currency:

- **Net proceeds** — what the copy brought in after commission, buyer handling and your shipping, at
  the sale's frozen exchange rate. A copy sold as part of a set is labelled **Share of net
  proceeds**: the set's net is divided between its copies in proportion to their catalog prices.
- **Cost basis** — what the copy cost you.
- **Profit / loss** — the share minus the cost basis.

A figure that cannot be worked out says so instead of showing a number: **No exchange rate** when
no rate to your base currency is known for the sale, **Cannot be split** when a copy in the same set
has no catalog price, **Pending** or **None recorded** for the cost basis — and then the profit reads
**Cannot be computed**. A cost basis still pending on an open lot shows the copy's **estimated** cost
in its place, marked `~`, as the copy's row does; the profit is still not worked out from it, because
an estimate is not what the copy cost. Hover any of them for the reason. See [profit and
loss](sales.md#profit-and-loss) for how the sale itself adds up.

### Going to a copy's purchase

A copy bought through a [purchase order](purchases.md) carries a **Go to purchase** entry in its
**⋮** menu, naming the order (supplier and date) underneath. It opens that purchase and takes you
straight to the **lot the copy is in**: the lot's card opens and scrolls into view, and **flashes
once** as it arrives — a tint and a brief outline — then reads like every other card on the screen.
If you had that order's copies grouped some other way, the order screen puts its **Group by** back
on **Lot** for the visit, since that is the only view with a lot card to point at; your remembered
choice is left alone ([Grouping the copies view](purchases.md#grouping-filtering-and-sorting-the-copies),
in the purchase order guide). There is nothing to close and
nothing left behind: the flash says how you got here, which stops being useful the moment you have
got here. The address bar drops the lot from it too, so reloading the page gives you the order and
no flash. (If your system is set to reduce motion, the tint and outline hold still for the same moment
instead of fading, and the page jumps straight to the card instead of gliding to it. See
[Reduced motion](appearance.md#reduced-motion).) A copy you added
by hand has no purchase behind it, so the entry is simply
not there.

**A link to a lot the order no longer holds does nothing, and says so by leaving `?lot=` in the
address bar.** That happens if the lot was deleted, or the copy was moved out of it, after the link
was made. Nothing flashes and nothing opens — there is no card to point at — and the parameter is
left where you can see it rather than being quietly tidied away.

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
- comes **off its location** — location and ref both cleared, with an entry in its
  [history](locations.md#where-copies-have-been) saying where it was. Restoring it does not put it
  back; file it anew ([Copies that leave](locations.md#copies-that-leave)).

The **Edit copy** dialog shows the disposal beside the delivery state rather than instead of it:
the two are independent, and both stay readable.

## Replacing a copy with a better one

When a better copy of a stamp comes in, the one it replaces usually goes to the sale stock. Record
that once as a **replacement** — *this new copy replaces that old one* — and settle it later, on a
round through your storage, from **Inventory → Replacements**.

### Recording a replacement

Open a copy's **⋮** menu on the Copies list and choose:

- **Replaces…** on the new copy, to pick the copy it takes the place of, or
- **Replaced by…** on the old copy, to pick the copy that takes its place.

A replacement can also be recorded while you identify a scan tile, with
[**Replaces**](purchases.md#identifying-stamps-intake) in the identification step — usually the
moment you decide it.

The choice is among your other copies of the same stamp that you still hold, the ones in the
collection first, each with its picture, condition and where it lies. Recording moves nothing: the
new copy stays where you filed it, and the old one stays where it is until you settle the pair.

A copy can be replaced by only one copy at a time — a copy already being replaced is listed but
cannot be chosen as the old copy, and says which copy replaces it. A copy can replace several: the
one you keep out of three replaces the other two. The entries are not offered on a copy you no
longer hold, have sold or traded away, or on a piece carrying several stamps.

### Reviewing your duplicates

Not every upgrade is decided when the new copy comes in. **Review duplicates**, on the
Replacements screen under the open replacements, lists the stamps you hold **in the collection**
more than once, each with its copies' pictures side by side — condition, where each lies, and its
number.

- **Keep this** on the copy you want to keep: every other copy of that stamp shown beside it becomes
  a replacement — *replaced by the one you kept* — and joins the open replacements above, to be
  settled on your next round like any other. Nothing moves yet.
- **Keep all** when you mean to keep every copy. The stamp leaves the review, and comes back only
  when another copy of it joins the collection. The confirmation offers **Undo**.

A copy that is already being replaced is shown with its stamp, saying by which copy, and is not
offered again. A stamp whose duplicates are all already in open replacements is not listed.

"The same stamp" is counted as the Copies list counts duplicates. Use **One stack per stamp** to
**Split by condition** (and by format or certificate, where your collection has them), so that a
mint and a used copy you keep on purpose are not offered as duplicates. The area tree on the left
and the condition filter narrow the review the way they narrow the Copies list; the area is the one
every list shares. The biggest stacks come first.

### Settling replacements

**Inventory → Replacements** lists the open replacements, each with both copies' pictures side by
side. The old copy is on the left with **where it lies** — its location and ref — and the list is in
that order, so it is the round to take them out in.

1. Choose the **current card** at the top: the sale location and its ref. The ref is offered as
   *Store* offers it — the card that location is up to — and **Next card** starts the next blank
   one. The figures under it say how many copies are on that card now, how many the ticked pairs
   add, and how many it will hold after.
2. Take the old copy out, put it on the card, and press **Done** on its row — or tick several and
   press **Done** above the list.
3. When the physical card is full, press **Next card**. There is no fixed number per card; you
   decide when it is full.

**Done** puts the old copy on the current card, takes it out of the collection and marks it **For
sale**. Nothing else about it changes — condition, photos and number stay — and the new copy is
not touched. The current card is not remembered when you leave the screen; choose it again on your
next round.

A replacement can be withdrawn with **Cancel replacement** in its row's **⋮**; neither copy
changes.

### When a replacement closes on its own

If either copy is sold, traded away, marked as no longer held, or deleted before you press
**Done**, there is nothing left to swap, and the replacement closes by itself. It moves to
**Recently closed** at the bottom of the screen, saying why — *Closed — #123 was sold*.

### A copy's replacement history

A copy's own page shows a **Replacements** card listing every replacement it is in — *Replaces
#45* or *Replaced by #123* — and how each stands: open (with a link to the Replacements
screen), done, cancelled, or closed and why. It stays there after the replacement is settled, so
both copies keep the record.

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
- **From the Edit copy dialog** — the **Never list on** control opens a list of your platforms to
  tick any number of them, so you can answer for all platforms at once without filtering the list
  first; closed, it names the ones picked (*Never on Allegro, Facebook*). What you leave unticked is
  *allowed*, so this is also where an exclusion is cleared away from the worklist.

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

If you later delete a platform, the markings that named it simply go with it.

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

A row of **filters** sits above the copies, the same controls the Copies screen's own toolbar
carries, for the stamps you hold many of:

- **In collection**, **For sale**, **For trade** — click a chip to keep only the copies carrying
  that flag. They combine: with both *For sale* and *For trade* on you get the copies that are
  both.
- **Condition**, **Delivery state**, **Format** and **Certificate** each open a checkbox list and
  take several values at once ("the mint grades", "everything still on its way"). Ticking nothing
  is no filter at all. **Single** and **No certificate** are tickable values like any other, since
  a copy with no format or no certificate is a real answer rather than a missing one.
- **Format** and **Certificate** appear only once your collection defines some.

The filters are the popup's own: they are not remembered, so the next stamp's popup opens showing
everything again.

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

## Cataloguing from card scans

If you have a lot of stamps to enter — a shelf of stockbooks, a collection you inherited, a gift —
typing them in one at a time is the slow way. Scan whole stockbook cards or album pages instead, cut
each scan into one piece per stamp, and identify the pieces on screen afterwards: open an
[opening balance](purchases.md#opening-balances) for them and use its **Card scans** section, which
the [purchases guide](purchases.md#card-scans) describes in full.

There used to be a separate **Card scans** screen here, under Inventory, and a **Scan a card** button
beside **Add copy**. Both are gone; what you had on that screen is now on an opening balance — see
[Where your Card scans went](purchases.md#where-your-card-scans-went).

## Adding a copy

The dialog has the **stamp** across the top and two columns under it: on the left what the copy
*is* — condition, certificate and format, faults and value reduction, value modifier, tags, notes —
and on the right
what is *done* with it — storage, delivery, disposition, **Never list on**, photos. **Edit copy** is
laid out the same way.

1. Click **Add copy**.
2. **Choose the stamp or variant** in one of two ways:
   - **Type to search** in the field. Suggestions match the stamp name, its issue name,
     **catalog numbers** — including the vendor and area prefix — and the **location ref**
     of any copy you already hold, so a shelf reference such as `A234` finds the stamp filed
     there. Catalog search ignores spacing, so `Mi PL 200`, `Mi PL200`, `MiPL200`, and just
     `200` all find the same stamp. Each suggestion shows its catalog number, name, issue,
     year, and area so you can tell similar stamps apart.
   - **Browse…** opens a larger picker — it fills the screen, so a big monitor shows more issues at once: pick an **area** on the left, filter its **issues**
     on the right, then expand an issue to choose a stamp or one of its variants. The picker
     remembers its area, year, and search text, so it reopens on the same filter you left it
     on — and the remembered text is **selected** when it opens, so you can just start typing
     to replace it. Its area and year are **its own**, one for every place the picker opens: narrowing
     the picker while identifying a card leaves the Issues, Stamps, Copies and Wants lists where they
     were, and narrowing a list leaves the picker alone. The filter also looks **inside** each issue: a term that matches a stamp's
     name or catalog number (but not the issue's own name) still surfaces that issue, opens it,
     and shows **only** the matching stamps — the rest of the tree is hidden, exactly as it is on
     the [Issues list](collections.md#filtering-the-issues-stamps-and-copies-lists). The stamps a
     match hangs under are kept, faded, because a variant is read through them. An issue that
     matched on its **own** name, year or number shows its whole tree, so nothing is ever hidden
     from a plain browse.

     The picker also remembers **which issues you had open**, and which of their checklist
     branches, so it reopens on the tree you left — scrolled to the issue you last picked from.
     That memory is one for every place the picker opens (identifying a scan tile, adding a copy,
     a lot, a trade or an auction lot), kept per collection in this browser, and it survives a
     reload. A search leaves it alone: an issue the search opened for you is not remembered, and
     clearing the search shows the tree as it was. Folding an issue forgets its branches.

     **Expand all**, in the toolbar beside **Show specialised checklists**, opens every issue the
     list shows to its stamps — the way each opens on its own chevron, under the **Checklists**
     view you chose — and reads **Collapse all** once they are all open. It stays on while you
     scroll further or change the area, years or filter: the issues that come into the list open
     too. Each issue's own chevron still folds or opens it. **Collapse all** closes every issue the
     list shows, the remembered ones among them. Expand all itself is not remembered: the picker
     reopens on the issues you had opened by hand.

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
   - **+ range** (beside it) adds a whole lettered run under that stamp in one save — `240a`
     through `240f` — the same as **Add variant range…** on the Issues list. The run appears in the
     tree ready to pick, and nothing is selected for you: which of the six the copy is, is the
     question you opened the picker to answer.
3. Choose the **condition** (required) and, optionally, a **certificate status**. Both
   come from your collection's configurable sets.
   Under them, pick the copy's **faults** — a thin, a crease, a missing tooth — if it has any. See
   [Faults](faults.md). Beside them, **Value reduction** lowers the copy's value by a percentage —
   see [Lowering a copy's value for its faults](#lowering-a-copys-value-for-its-faults). Under
   them, **Value modifier** adjusts its catalog value by a percentage and an amount, with a note —
   see [Adjusting a copy's catalog value](#adjusting-a-copys-catalog-value).
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

It is shown as the plain number — `#123` — everywhere: on screen, on printed packing lists and
enclosures, and in the card-scan tiles, the way an offer's, a sale's or a post's number is. It is
never padded with zeros. A listing template writes it with the
[`{itemNo}` token](platforms.md#listing-templates) — plain too, unless the template asks for padding
with `{itemNo:4}` (`0042`).

Two things to expect:

- **Numbers are never reused.** Deleting copy `#123` retires that number — the next copy you add
  continues past the highest number handed out, it does not fill the gap. A number you have already
  written on a piece must never turn up on a different one.
- **Numbering is per collection.** Each collection starts again at `1`, so the numbers are yours
  rather than an artifact of the installation.

To find a copy by its number, type it into the inventory search box with the `#` — `#123` lists
that copy and nothing else, and so does `#00123`, so a label written while numbers were still padded
finds its copy too. A bare `123` works as well, but it also lists every copy with 123 among its
catalog numbers. The same holds in the pickers that list copies — **Attach existing copies…** on a
purchase lot, **Add set** on an offer, and **Add copies** on a sale and on a trade.

Copies that already existed before this feature were numbered in the order they were added, oldest
first.

## Editing a copy

Open the row's **⋮** menu and choose **Edit**. The same dialog opens with the copy's
current values. Changing the stamp to a more specific variant re-points the copy and
records the change in its refinement history. The **Stamp** field is also where you say a
piece carries more than one stamp — see
[covers and other pieces carrying several stamps](#covers-fragments-and-other-pieces-carrying-several-stamps);
reordering that list, or striking a stamp off it, records no refinement, because neither says the
copy was identified as something else. The dialog also carries the **Never list on**
control — see [copies you never list on a platform](#copies-you-never-list-on-a-platform).

Changing the copy's **Location** or **Ref** is recorded in its location history, shown on the
copy's own page — see [where copies have been](locations.md#where-copies-have-been).

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

Formats are managed in **Settings → Formats**. A format that is used by any copy or
any catalog price cannot be deleted.

**Formats in other languages.** Once a platform lists in — or an album is printed in — a language other than your collection's
default, the format's pane grows an **Abbreviation** and a **Name** box per language, exactly as
[conditions](collections.md#conditions-in-other-languages) do — and they fall back independently, so
you can translate *Block of 4* as *Viererblock* while leaving `Blk4` alone. These feed the
`{format}` and `{formatAbbr}` tokens in [listing texts](platforms.md#listing-templates).

### What a multiple is worth

Catalog values are recorded per format, on the same grid as everything else: the stamp editor's
**Prices** tab has a row of format tabs above the condition × certificate grid, starting with
**Single**.

Most of the time you will not type these in. Catalogs publish multiples as a **multiplier** — one
Viererblock factor for a whole issue — and record an explicit price only where a multiple is out of
line. Stamporama follows that: set the multipliers once under **Settings → Formats →
Multipliers**, and every format's price is derived from the single's. Derived values appear
in the grid as greyed, dashed placeholders — nothing is stored. Type over one where the catalog
disagrees and it becomes a real price that always wins; clear it to fall back to the derived value.

A multiplier can be pinned to an **area** (covering everything beneath it), an **issue**, and a
**condition** — used blocks are often scarcer relative to mint than a single factor can express. A
multiplier with none of these set is your collection-wide default. When several could apply, the
narrowest anchor wins, in this order: **issue** first, then the **nearest area**, then
**condition**. So a factor set on an issue beats a collection-wide factor set on "used".

You set each one where its scope lives, so you never pick the thing it applies to out of a list:

- **Collection-wide and per-area** — Settings → Formats → Multipliers.
- **One area** — also from that area's **⋮** menu on the **Areas** screen, which is usually quicker.
  How the covers and fragments under that area are valued is set in the area's **Edit** dialog (see
  [What a piece carrying several stamps is worth](#what-a-piece-carrying-several-stamps-is-worth)).
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

### Prices on cover and on piece

Catalogues price a stamp on a cover differently from the same stamp used loose, and print those prices
as **columns** beside the loose ones, the way they print ** and ⊙. Michel quotes a ⊠ price per stamp for
a genuinely posted, correctly franked cover, by how the cover is franked, and a price on piece
(*Briefstück*):

| Michel's column | What the catalogue means |
| --- | --- |
| **EF** | single franking — the stamp alone on the cover |
| **MeF** | multiple franking — the same stamp several times |
| **MiF** | mixed franking — the stamp with other stamps |
| **Bfst** | the stamp on a piece cut from a cover |

Fischer prints one ⊠ column — or, for some areas such as the General Government, **FP**, **FW** and
**FM** (single, multiple and mixed franking).

These columns are **conditions you define**, under **Settings → Conditions**, marked
[*Price column only*](collections.md#price-column-only-conditions): name them, abbreviate them, give them
a symbol (⊠) and translations as you like. They then are columns of the price grid beside *MNH* and *U*
— per catalogue edition and certificate, `-` and `?` working on them as on any price — and you type a
catalogue row straight across. **Fill from another condition** on the
[variant price grid](variant-prices.md#filling-one-condition-from-another) fills one of them from
another by a ratio, once; nothing derives them on the fly.

Which column is which is told to each **valuation method**, under **Settings → Valuation methods**: for
*Michel*, which condition is its used price, its cover EF, MeF and MiF, its on-piece price and its
never-hinged price; for *Fischer*, its used, cover ⊠ and on-piece; for *Fischer FP/FW/FM*, its used, FP,
FW, FM and on-piece; for *Sum of used*, its used. Any condition can be chosen — *used* is normally your
ordinary *U* — and one condition can serve several methods: Fischer's ⊠ and Michel's MiF may well be the
same column. A role left at *Not set up* is not read, and a piece valued by that method says so (see
[What a piece carrying several stamps is worth](#what-a-piece-carrying-several-stamps-is-worth)).

#### Stamps still valid for postage

Michel prints no ⊠ price for a stamp that can still frank a letter, and says how to value one on a
cover instead: **at least 0.40, or about 20 % above the used price — but no more than the
never-hinged price when that is above 0.40**. The *Michel* method applies that rule for you.

- **Mark what is still valid** in the **Edit** dialog of an area on the Areas screen, or of an issue
  on the Issues list: **Still valid for postage** — *Yes*, *No*, or *Same as parent* (*Same as its
  area* on an issue), which names what it resolves to and the area it comes from. An area's mark
  reaches every area and issue beneath it; *No* on an issue under a marked area takes just that issue
  out. Choosing what the parent already says is saved as *Same as parent*, so a later change above
  still reaches it.
- **Map Michel's used and never-hinged prices** under **Settings → Valuation methods**. While either is
  not set up, the rule gives nothing, and the piece's value names the one missing.

Where a still-valid stamp on a cover valued by *Michel* has no price in the condition Michel's cover EF,
MeF or MiF is mapped to, the method works one out from that edition's used and never-hinged prices. The
0.40 is in the catalogue's own currency; without a used price there is nothing to work from, and without
a never-hinged price nothing caps it. The figure is the method's working, not a catalogue price: it is
shown with `~` in the cover's Valuation window and in identification only, never written to the stamp's
prices and never shown on the price grid or the lists. A price you type always wins.

## Covers, fragments and other pieces carrying several stamps

A cover franked with three different stamps, a fragment cut from a parcel card, an FDC — one piece of
paper you cannot take apart, carrying catalog numbers the catalog never numbered as a whole. It is
**one copy**, like a block of four, and its **Format** says what the piece is: *Cover*, *Piece*,
*FDC* — ordinary format entries you add under **Settings → Formats**, beside *Block of
4*.

What is new is the list of stamps on it. Open the copy's **Edit** dialog and the **Stamp** field is
that list: add a stamp with the same picker you always used, drag the rows into the order the stamps
sit on the piece, and give each one a **quantity** and a **format of its own** where it needs them —
a block of four *on* the cover is one entry with the format *Block of 4*, never four entries. The
same stamp twice loose is one entry of quantity **2**. A row's format list names the formats as the
copy's own **Format** does — full name with the abbreviation, *Single* first — and where the row is
too narrow for the whole name, hovering the control names the chosen format in full. Each row starts
with the **stamp's own picture** — the variant's, once a variant is picked — so the rows of a set that
all read alike can be checked against the piece in hand; rest the pointer on it to enlarge it, or
click it to open it full size. A stamp without a picture shows the empty placeholder.

A cover franked with eight stamps is **one trip through the picker**, not eight. **Browse…** stays
open while you tick every stamp on the piece — pressing a stamp ticks it, pressing it again takes it
off, and searching for another issue keeps what you have ticked, so the stamps may come from several
issues. The list beside the tree shows what is ticked, and **Add 8 stamps** puts them all on the
piece at once: each as quantity **1**, single, after the rows already there and in catalogue order,
ready to be given quantities and formats and dragged as usual. A stamp **already on the piece** can
be ticked again: it raises that entry's quantity by one rather than adding a second entry, and the
same goes for a stamp typed into the search box beside **Browse…**, which still adds just the one.

A copy added by hand starts as one stamp, and becomes a carrier when you say so here. A tile cut from
a card scan can be identified as a carrier straight away — **Another stamp on this piece…** in the
identification's condition step, see [Card scans](purchases.md#working-through-the-tiles). Take the
list back down to one row and it is an ordinary copy of that stamp again.

### A piece has no condition

A cover, a fragment, any piece carrying several stamps — and a piece carrying **one** stamp whose
format is of kind *On cover* or *On piece* — has **no condition**. "MNH" on a posted cover describes
nothing, and the piece's value never read it: its state is told by its **franking** and its
[faults](faults.md). So the **Condition** field is not shown for it, in the copy's **Edit** dialog or in
a scan's identification, and nothing shows a condition for it. Its certificate stays — a cover can be
certified as a whole.

- Picking a format of kind *On cover* or *On piece*, or adding a second stamp, **drops** the condition.
- Turning a piece back into a loose stamp — one stamp, a format without a kind — **asks for one**: the
  **Condition** field comes back, and the copy cannot be saved without it.
- Giving a format a kind under **Settings → Formats** drops the condition of every copy in it. Taking
  the kind away is refused while one-stamp copies are in that format: move them to another format
  first, giving each a condition.
- The condition remembered for the next copy you add is neither used for a piece nor changed by one.

### What a piece carrying several stamps counts as

**Nothing — for any of its stamps.** This is the one thing worth reading twice:

- the copy-count badges beside its stamps on the Issues and Stamps lists do not count it;
- an issue's **Completeness** card does not tick those stamps off, and a lot's set figure does not
  treat them as stock;
- a **want** for one of them does not close, and the arrival review does not offer to close it;
- a **Colnect list** comparison leaves it out entirely, on both the collection and swap/sell lists.

The same holds for a cover carrying **one** stamp, on a format of kind *On cover* or *On piece*: it is
counted towards none of that stamp's holdings either — not in the badges, *You hold*, the
completeness card or the wants. A piece is not a copy of its stamps: you cannot supply Mi 200 off it,
because it will be sold whole. Its stamps are a **description** of the piece — searchable, listed,
printed in listing texts — never a claim that you hold them.

Everything else about a copy is untouched. It keeps its internal number, its storage location, its
cost basis and its photos; it can be offered, sold, traded and disposed of exactly like any other
copy, and it stays on the Copies list. When you offer it, the `{catalog}` token in the listing's title
and description names **every** stamp on it — see [Catalog numbers](platforms.md#catalog-numbers).

### Finding them on the Copies list

There is no separate screen for these pieces: they are ordinary rows on the Copies list, with the
same checkboxes, **⋮** menu and endless scrolling as every other copy. What sets the row apart:

- a **Several stamps** chip, with the same explanation the copy's own page gives;
- the **catalog number of every stamp on it**, in your order, each followed by its format and
  quantity where they are not a plain single, once — never a count standing in for them;
- the names of all its stamps as the row's title, and no issue date or series, since those belong to
  one stamp rather than to the piece;
- no [want marker](#the-want-marker).

The **search box** finds a piece by any stamp it carries, not only the first: type the third number
on a cover and the cover comes up. The **Several stamps** filter on the toolbar narrows the list to
these pieces or leaves them out, and grouping by duplicates or by issue collects them — with every
cover carrying one stamp — into one **Covers and pieces** row at the end
([Grouping the list](#grouping-the-list)).

Its own page shows the stamps it carries in your order, under **Stamps on this piece**, and a
**Several stamps** chip beside the state chips says why the counts leave it out.

### What a piece carrying several stamps is worth

No catalog prints a price for your particular cover, but catalogs say how to value one from its
stamps' prices — and the app does that for you. A cover's, a fragment's or any piece's catalog value is
**computed by a valuation method** from the prices of the stamps on it: their used prices, and the
[prices on cover and on piece](#prices-on-cover-and-on-piece) you record for them — each read from the
condition the method is told it is, under **Settings → Valuation methods**.

**What kind of piece it is** comes from its format. Under **Settings → Formats**, give each format
you use for pieces a **Kind**: *On cover* for *Cover*, *On piece* for a fragment, or *Neither*. A
format with a kind has no prices of its own and is not a tab of the price grid: a cover's value is its
method's. A want, an auction lot line or a trade line in such a format is valued the same way, as one
stamp once on a rate-correct cover. A piece whose format has neither kind — an FDC, for
now — is valued as the sum of its stamps' used prices, whatever its method: no method reads a cover
price off a format that does not say the piece is a cover, so to value it by one, give it a format of
kind *On cover* or *On piece*. One stamp alone on a cover is valued the same
way, as a cover (its cover EF price under Michel), and still counts as a copy of that stamp. It is
shown the same way too: its Valuation window and its identification list the stamp with its price
fields and the computed value, as for a piece carrying several. In both, each stamp's row starts with
the stamp's own picture, and a stamp in a format other than single names that format in full with its
abbreviation — *Block of 4 (Bl4)* — since its price is read at that format.

**How a cover was posted** is its **franking**, set in the copy's **Edit** dialog, or next to the stamps
on the piece when you identify a card scan tile:

- **Rate-correct** — genuinely posted and franked for the postal rate. Every piece starts here.
- **Philatelic, posted** — overfranked, a set cover and the like, but genuinely posted.
- **Not posted**.

**The methods**:

| Method | Fragment | Cover, rate-correct | Cover, philatelic | Cover, not posted |
| --- | --- | --- | --- | --- |
| **Michel** | sum of on-piece prices | EF: the stamp's EF price · MeF: its MeF price · MiF: the highest MiF price among the stamps | the most expensive used price + 15 % | sum of used prices |
| **Fischer** | sum of on-piece prices | EF: the stamp's ⊠ price · MeF: 150 % of ⊠ for two stamps, every further one at its used price · MiF: 50 % of the highest ⊠, every other stamp at its used price | as rate-correct | sum of used prices |
| **Fischer FP/FW/FM** | sum of on-piece prices | EF: FP · MeF: FW · MiF: the highest FM | as rate-correct | sum of used prices |
| **Sum of used** | sum of used prices | sum of used prices | sum of used prices | sum of used prices |

A sum of used prices takes every stamp in its own format — a block as a block — times how many of it
there are.

**No piece is valued below the sum of its stamps' used prices**, whatever the method, the franking or
the format: the value is the greater of what the method's rule gives and that sum. Michel values a
philatelic cover at most 15 % above its most expensive used stamp, so a cover with six stamps at ⊙ 1.33
would come to 1.53 by the rule — less than the 7.98 the stamps are worth soaked off. It is valued at
7.98. Under *Sum of used* the sum is the value already.

**EF, MeF or MiF** is read off what is on the cover, counting stamps rather than rows: one stamp once is
EF; one stamp several times — a quantity above 1, or a block of it — is MeF; more than one stamp is MiF.
Under Fischer a block counts as one stamp, since the app does not know how many stamps a format holds.

**Where each price is read from** is the method's: under **Settings → Valuation methods**, each
method's card lists the prices it reads — *Used*, *Cover EF*, *Cover MeF*, *Cover MiF*, *On piece* and
*Never hinged* for Michel; *Used*, *Cover ⊠* and *On piece* for Fischer; *Used*, *FP*, *FW*, *FM* and *On
piece* for Fischer FP/FW/FM; *Used* for Sum of used — with a condition picker beside each. Every price,
the used price too, is read in the condition chosen there, as a single, with no certificate, at the
latest catalog edition, in your collection currency; the piece's own condition does not change its
value. Nothing is set up to begin with: until you choose them, a piece valued by that method says which
of its prices are **not set up**, with a link to the page, and no price is ever read in another's
place.

**Which method** values a piece: the collection's default, **Michel** unless you change it under
**Settings → Valuation methods**; an area's own, set as **Valuation method** in its **Edit** dialog on
the Areas screen — *Same as parent* names the method it inherits and from where — and inherited by the
areas below it; or the copy's own, which wins over both — set in its
**Edit** dialog, in its **Valuation** window, or when you identify a card scan tile as the piece. The area that decides is the area of the piece's **most expensive stamp** — the one
with the highest used price, read in the condition the collection's default method takes its used
prices from.

**A missing price** makes the value **partial**: the figure counts what is priced, and the missing
price is marked on its stamp. A missing **used** price makes it partial under every method, since the
sum of used prices could have been higher. A price whose condition is **not set up** makes it partial too, and the
value names the method and the price — *Michel's Cover MiF is not set up*. With nothing priced at all
the piece is unpriced, and its row shows **+ prices**.

**How the value was reached** is the piece's **Valuation** window (its row's **⋮ → Show valuation**, or
click its value), read top to bottom:

- **Each stamp on the piece**, numbered, with a field for each price the value reads: its **used**
  price and its price **on the piece** — the one the method reads for this piece: its cover EF, MeF or
  MiF price on a cover, by what is on it (under Fischer its ⊠ price, under Fischer FP/FW/FM its FP, FW
  or FM), its on-piece price on a fragment. Each column is headed by the condition it is read from —
  *U*, *MiF*, *FM* — and a price whose condition is not set up shows **not set up** instead of a field.
  A dash is a price the value does not read. A price Michel's rule works out for a stamp still valid
  for postage shows greyed, with `~`, in its empty field. **Type the prices in
  place**, as in a checklist run: a price already on file is filled in and can be typed over, a
  missing one is framed in amber, and a note above the stamps counts how many are still missing. Tab
  goes from one field to the next in the list's order. `1,50` and `1.50` are the same figure; `-`
  records that the catalog says the stamp does not exist there and `?` that its price cannot be
  determined, as on the price grid. The same stamp twice on the piece has one field — the other row
  shows its figure and says *as #1*. A stamp with variants asks for its **variants'** prices on lines
  under it, with **Full grid…** for every other condition, certificate and format. Each price is
  saved in its column's condition, as a single, with no certificate, at the latest edition of the
  stamp's main catalog, in that catalog's currency.
  **The value and its arithmetic follow as you type**, before anything is saved. **Save prices**
  appears once a price is typed and records them as the stamps' catalog prices, so every other piece
  and copy of those stamps reads them too. Closing the window without saving keeps nothing, and the
  window asks first.
- **The computed value**, then the arithmetic it is — *MiF: 50 % × Mi 123 ⊠ 40.00 PLN + Mi 124 ⊙
  2.00 PLN = 22.00 PLN* — so you can check it against the catalog: each price is named by its
  condition's symbol where it has one (⊙, ⊠), else its abbreviation, and a price Michel's rule worked
  out carries `~`. Every amount names its currency. The prices are compared in the collection's
  currency, so a price your catalog gives in another one is shown with its original first —
  *⊙ (1.80 EUR = 7.95 PLN)* — and the rule is applied to the converted figure; the total is in the
  collection's currency. A price the
  sum needed but is missing is printed as a dash where it would have been added, and the value says it
  is partial. The sum of used prices follows, and which of the two is the value — *Philatelic: 115 % ×
  Mi 7 ⊙ 1.33 = 1.53 · Sum of used 7.98 is higher → 7.98*, or *… · Sum of used 14.00 is lower → 50.00*
  when the rule's figure stands.
- **The method**, the franking and EF/MeF/MiF in one line, and where the method came from — an area,
  *set on this copy*, or the collection's default.
- **Franking**, on a cover, and beside it **Method**, both of which you can change right there: the
  value follows at once, here and on the Copies list. **Method** starts with *As inherited* — naming the
  method and where it comes from, *As inherited (Michel, from Germany)* — then each method; choosing a
  method gives the piece its own, and choosing *As inherited* takes it off again.
- On a piece whose format has neither kind, the line says so and that the fix is a format of kind *On
  cover* or *On piece* — the method is not what is missing.
- **Value modifier**, **Amount** and **Modifier note** — the copy's
  [modifier](#adjusting-a-copys-catalog-value), folded to one line unless the copy has one, which you
  can change right there: the figures below
  follow what you type at once, and **Save modifier** keeps it. Closing the window with a modifier
  typed and not saved asks first, as it does for prices.
- Your **modifier** with its note, and the **reduction for faults**, each with the figure it gives,
  ending in **Value of this copy** — the figure every list and total reads.

The same price fields and arithmetic show when you identify a card scan tile as a piece carrying
several stamps, where **Identify the tile** saves the prices — see
[Working through the tiles](purchases.md#working-through-the-tiles).

The computed value is what the Copies list total adds up, the asking price pre-filled when you list the
piece, your own valuation of it in a trade and the figure a trade partner's catalog gives it. Its own
page calls it the **Computed value**. Your [value modifier](#adjusting-a-copys-catalog-value) and
[value reduction](#lowering-a-copys-value-for-its-faults) adjust it as they adjust any copy.

**A value you recorded on a piece before** is kept: it became the piece's modifier amount — the
difference between what you recorded and what the method gives — so the piece is worth exactly what it
was. Formats named *Cover*, *Piece* or *Fragment* were given their kind at the same time.

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

### A copy of unknown variant

When the copy's stamp has **variants of its own** — the copy carries the *unknown variant* chip — the
catalogue has no price for the stamp itself: it prices each variant, and the copy is worth the
lowest of them. So the dialog asks for those instead. In place of the per-catalog inputs it shows the
same **Variant prices** list the [identification step](purchases.md#pricing-an-umbrellas-variants-while-identifying)
does: one field per variant down the tree, for your primary catalogue's latest edition, at the
copy's **condition, certificate and format**, with the stamp's resulting value and how many variants
are still unpriced in the heading — *≈3.20 EUR · 2 of 5 variants unpriced* — updating as you type.

- Each price is saved as you leave its field (**Tab** goes to the next variant).
- **Done** saves the field you are still in and closes the dialog; the copy's value updates in
  place. There is no Cancel, because there is nothing left to undo.
- On a copy that is not a single, a variant with no price of its own for that format shows the value
  worked out from its single's price as a dashed placeholder — typing over it records a price for
  that format explicitly.
- **Full grid…** opens every condition, certificate and format of the tree, and is where a price is
  recorded on the umbrella itself.

The same holds wherever a copy's **+ catalog value** opens — a purchase order, an offer, a trade, an
auction lot.

To work through the gaps in bulk, turn on the **Missing catalog value** filter to list only the
copies that still need pricing, then click each row's **+ catalog value** in turn.

## Adding a copy to an offer

You can list a copy for sale without leaving the Inventory screen. On a copy that is
marked **For sale**, the row's **⋮** menu shows an **Add to offer** action. It opens a picker of
your [offers](offers.md):

- A **state** panel on the left filters by **Preparing / Active / Paused** (with counts) — the
  offers you're still composing come first.
- Each offer is listed by its **title** — the one you typed, or the one the app generated — with
  the label derived from its sets underneath, so you recognise a listing either by what you called
  it or by what is in it. An offer with no title shows that derived label on its own.
- The search box matches the **title**, the derived label, the platform, a set, a
  **catalog number**, or the **location ref** of a copy inside a set.
- Each offer expands to its existing sets; **Show contents** reveals the exact copies a set holds.

Choose where the copy lands: **＋ New set** on an offer (a fresh single-item set), or an
**existing set** — dropping it in turns that set into a series sold together. Confirm with
**Add to offer**. Only the offer you pick is affected.

Starting a brand-new offer from the copy is in the same picker: **＋ Create new offer** opens the
offer header form (platform, currency). When the copy has a [catalog value](#copy-value-and-holdings-total),
the **asking price** is pre-filled with its **Estimated value** — that catalog value corrected by how
far the catalogue runs above what stamps fetch (see [the price table](offers.md#the-price-table)) —
converted into the offer's currency and fully editable, so you can accept, adjust, or clear it. (A
copy with no catalog value leaves the price blank. Several copies are priced as the set they make —
see [What is going into the new offer](#what-is-going-into-the-new-offer).)
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

Offering the same thing twice is worth knowing about before you do it — some marketplaces (Colnect
among them) refuse the second listing outright, others simply leave you with two competing entries.
The picker points these out before you commit: an offer that already holds a set of **exactly the
stamps you are adding, in exactly the same conditions**, through other copies, carries an amber
**same set + condition already here** marker.

**"The same thing" means the whole composition, not a shared stamp.** A marketplace entry is what it
lists taken together: on Colnect the series 1–3 and the single stamp 2 are two different items. So if
an offer holds the series 1–3 and you pick out stamp 2 on its own, nothing is flagged — that single
is its own entry and duplicates nothing. Pick all three and the warning appears. Reaching *past* the
set is silent too: picking 1–4 against a listed 1–3 is a fourth thing again.

Quantity is not part of the question. Picking two sets' worth of the same series still matches a
single-set offer of it — that is the same entry offered more of, which is exactly the case worth a
word. And an offer whose sets differ from one another is compared set by set: it conflicts if any one
of its compositions is the one you picked, never by pooling them together.

**On a platform that lists an unidentified variant under its cheapest one, a stamp counts as what it
will be listed as.** Colnect is such a platform: a copy of `523` whose variant you haven't identified
goes on Colnect under [its cheapest variant](offers.md#a-stamp-whose-variant-you-havent-identified) —
say `523I` — which is the very entry a copy identified as `523I` goes on. So picking the `523` copy
while an offer of the `523I` copy is live warns, and **Add to #N instead** puts it in as a second unit
of that listing. The answer is worked out the way the listing works it out: per condition (a used
`523` may resolve to `523I` and an MNH one to `523II`), from today's prices, and following a variant
you [picked by hand](offers.md#saying-which-variant-it-should-be) on the offer already listed. On a
platform that lists `523` as itself, `523` and `523I` stay two different things.

The warning only ever states the fact — *this is already offered on platform X, the same stamps in
the same conditions*. It does not claim a rule, because whether it blocks anything depends on the
platform you are listing on.

When at least one offer conflicts, the left facet panel grows a **Conflicts** group with a
**Same set + condition** entry and its count. Click it and the list narrows to just those offers;
clicking any **State** facet leaves it again. It appears only when something actually conflicts, so
an ordinary add never grows a facet reading zero.

It is a **warning, not a block**. The offer stays pickable and nothing is left out of the add — you
may have a reason (a deliberate re-list, a platform without the rule). Only the copies the offer
*literally* already lists are ever dropped from an add.

The **＋ Create new offer** form checks the same thing for the platform in its Platform field, and
shows an amber banner naming the offers that already list this composition — including their offer
numbers, so you can go and look. Switching the platform re-asks the question. Offers in every live
state count (**preparing, ready, active, paused**), so a duplicate is caught while both listings are
still drafts.

## Adding several copies to an offer at once

Every copy you still hold carries a **checkbox** on the left of its row. Tick a few and a bar
appears under the toolbar saying how many are picked, with **Clear**, [**Bulk
edit…**](#bulk-editing-the-selection), the [new-offer shortcuts](#the-new-offer-shortcuts) and
**🏷 Add selected to offer**. The same actions are a click away from the row you are on, through
[the selection menu](#the-selection-menu-on-a-ticked-row).

The bar **stays put while you scroll**, like the toolbar above it. It takes its space from the list,
so **the first tick pushes the rows down** by the height of the bar — and then nothing moves again
until you clear the selection. Nothing is ever covered: every row can still be read in full,
including the first one.

That one shift is a known annoyance rather than an oversight, and it is the **same on every list**,
long or short. It was fixed once, in a way that held the rows still by scrolling the page under the
bar instead — but that could only work on a list long enough to have something to scroll, so a short
list still moved and a long one did not, and there was no way to tell which you were about to get.
One predictable jump turned out to be easier to work with than a jump that depends on how many rows
happen to be on the screen. The proper answer is a rethink of the bar itself, which is still to come.

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

The selection survives scrolling further down the list, and it survives a **filter change** too.

**A filter is a way of looking, so it never unticks anything — and nothing you do from the bar ever
reaches a copy you cannot see.** Narrow the list and the copies you had picked that are no longer
showing stay picked: the bar says so — *2 of 5 ticked copies in view* — and tells you the other
three are still ticked and come back when you release the filter. Everything on the bar acts on the
two in view, so a bulk edit or an offer can never touch a copy you are not looking at. Widen the
list again and all five are back.

So the number moving when you press a filter is the filter, not a lost selection. If the filter
hides **all** of them the bar stays up saying *0 of 5*, with nothing on it but **Clear** — it is the
only place those five are still visible. **Clear** is the other way round: it is you saying you are
done with the selection, so it unticks all five, hidden ones included, and its hint says so.

Two different things narrow this bar and they are said separately. *In view* is the bar's own
count — what is on screen. *For sale and in hand* is what the **listing** buttons ask on top of it,
and their hints name that count where it differs (*"Applies to the 3 of the 4 copies in view that
are for sale and in hand"*). A group you have folded shut still counts: its header is on screen with
its own tick box, and folding a row is a way of reading the list, not a way of filtering it.

### Conflicts in the selection bar

While the **Not offered on…** (or **Never listed on…**) filter names a platform, the bar also
answers the [already-offered](#the-same-stamp-in-the-same-condition) question for that platform: if a
live offer there already lists **exactly what you have picked** — the same stamps, the same
conditions — an amber line says *this is already offered on platform X in this condition*, and beside
it is **Add to #12 instead** — one click to put the selection into that existing offer rather than
making a second listing of the same thing. The tooltip on the warning lists every conflicting offer
when there is more than one.

While that warning is up, the bar's **＋ New offer** buttons and **Add selected to offer** turn amber
too — the warning is easy to read past, and those are the buttons that would create the duplicate.
They still do exactly what they say: it is a colour, not a block, and you may well know what you are
doing. They go back to normal as soon as the conflict does — when you change the selection, or use
**Add to #12 instead**.

The shortcut opens the ordinary **Add to offer** picker with that offer already picked as the
destination (as a **＋ New set** on it) **and the Same set + condition facet already on**, so the
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

### What is going into the new offer

The create form lists **every copy going into the offer** beside its fields, each as a full row with
its photo — whichever way you reached it: the **＋ New offer** buttons, **＋ Create new offer** in the
picker, or **Add to new offer** on one copy. So you can check the contents before creating the offer
without closing the dialog.

- **The summary** above the rows says how many copies there are, their **catalogue value** and their
  **cost** together, in your collection currency. Cost follows the rule an offer's own cost does: a
  copy whose purchase lot is still open counts at its estimate, and the figure is then marked `~`; a
  copy from an opening balance counts at its opening value, and the figure is then labelled **Cost
  incl. opening value**. Hover a figure to see what it leaves out — copies with no catalogue value, no
  cost recorded, no estimate yet, or on the opening balance with no value; with no cost at all, the
  reason is written under the *—*.
- **Each row** shows the copy's cost just before its catalogue value — its **opening value**, so
  labelled, for a copy from an opening balance.
- **Order** the rows *As picked*, by **Catalogue value** or by **Cost** — highest first, so an
  expensive copy that slipped in stands out — or in the series' own order, for checking it for gaps
  and doubles:
  - **Series order** puts each checklist's copies together in the checklist's order. A copy on
    several checklists sits under the one that holds most of the offer, checklists follow one
    another by catalogue number, and the copies on no checklist come last, by catalogue number.
    Specialised checklists count only while they are switched on.
  - **Catalogue number** reads the numbers as the Copies list sorts them — *45, 46, 46a, 47, 100* —
    with a copy that has no number last.

  With the rows grouped, each group follows the order chosen.
- **Filter** the rows to read a long set in parts: **Duplicates only** (every copy of a stamp or
  variant that goes in more than once, whatever the packaging), **conditions**, and **Worth at
  least …** — a catalogue-value floor in your collection currency, for finding what is too valuable
  for the set; a copy with no catalogue value is hidden while it is set. **A filter only hides**: a
  hidden copy still goes into the offer, the summary still describes the whole offer and says how
  many copies the filters hide, and **Clear filters** brings them back.
- **Group** the rows **by issue** or **by stamp** — the latter puts every copy of the same stamp or
  variant together, so duplicates sit side by side. Each group's heading gives its count, catalogue
  value and cost.
- **The same stamp twice.** When the copies go in as **one set**, two or more copies of the same stamp
  or variant — whatever their conditions — are tinted amber and marked *same stamp ×2*, and a warning
  at the top says how many stamps are doubled from the moment the form opens. Packaged **one set
  each**, no set holds anything twice, so there is nothing to warn about.
- **The asking price** is suggested for **one set**, since an offer's price is what a buyer pays
  for the set they take. Going in as **one set**, the copies are suggested at the **sum** of their
  Estimated values, whatever the stamps — a three-value series at the three added together. Going in
  **one set each**, they are suggested at **one piece's** Estimated value, when every copy has the
  same one; copies whose estimates differ get no suggestion. A copy with **no Estimated value** leaves
  the price blank either way, and the line under the price says how many copies have none, so a sum
  never looks complete while it is not. On a [Facebook group](facebook.md) that opens at a share of
  the catalogue value, that share is taken of the catalogue value on the same rule. Whatever you type
  stays.
- **Take a copy out** with the **−** on its row (or **Remove from this offer** in its **⋮** menu). The
  summary, the warning and the suggested price follow at once. Only the offer being made loses it: the copy stays ticked on
  the Copies list. The last copy cannot be removed — cancel instead.

The form's **Title** field starts with the title the platform's template gives these copies, and
follows a change of platform or a copy taken out until you type in it. What you type is the offer's
title; see [Listing title](offers.md#listing-title).

### The selection menu on a ticked row

The bar's buttons sit at the far end of the bar, a long way from the checkboxes you have just been
ticking. So while copies are ticked, **resting the pointer on a ticked row** shows a small checklist
button just under that row's checkbox. It opens a menu of **everything the bar can do** — for the
whole selection, not for that one row — and every entry says how many copies it reaches:
*Bulk edit 5 copies…*, *Make a collage of 5 copies…*, *Sell 5 copies…*, *New offer · 5 sets*,
*Add 5 to offer*.

It is a shortcut, not a second place to look things up: the bar is still where you see what is
ticked, how many are hidden by a filter, and whether the selection is already offered. When it is,
the offer entries in the menu repeat the warning under their names. Anything added to the bar in
future appears in this menu too.

Nothing appears on an unticked row or with nothing ticked, and the button takes no room of its own,
so ticking never moves anything. It works the same on the copies inside an expanded group. Press
**Escape** or click elsewhere to close the menu.

The same checkboxes are on the copies inside an expanded [duplicate group](#grouping-duplicates), and
a group row can tick all of its copies at once — see [Listing a group's
copies](#listing-a-groups-copies).

### Quick offer mode

Listing a hundred and seventy-eight copies one at a time means a hundred and seventy-eight trips
through the create form, each asking for the same platform. **Quick offer mode** sets it once and
takes the form out of the loop.

Press **Quick offer mode** at the top of the list. A bar appears under the toolbar, pinned there
while you scroll, with two things in it:

- **Platform** — which marketplace these offers are listed on.
- **Group** — on Facebook only, the group the offers are in. It starts on the last group you
  used there, and until one is chosen the mode creates nothing on its own: **Add to new offer** opens
  the form instead, and the bar says why. See [Facebook](facebook.md#without-the-form).

When copies are ticked as well, this bar sits **above** the selection bar: quick offer mode is the
mode you are in, the selection is what you are doing inside it. Like the selection bar, arming the
mode shifts the list down once to make room — you asked for it with a click, so nothing is under way
at that moment.

From then on, every **Add to new offer** — the entry in a copy's **⋮** menu, its promoted icon on the
row, and the **New offer** buttons in the selection bar — creates the offer **straight away**, with
no dialog. The menu entry says so while the mode is on: it reads *New offer on Colnect* rather than
*Add to new offer*. The bar counts what the pass has created so far, and reports anything that failed.

The new offers start **Preparing**, like every new offer, and carry **no asking price and no listing
URL** — except on Facebook, where a group that
starts its offers as auctions makes each an auction opening at the group's starting price. That is the point: the pass is about
getting the listings made, and both of those belong on the offer's own screen once the listing
exists. If you want the price filled in from the copy's Estimated value, use the ordinary
[create form](#the-new-offer-shortcuts) instead — quick mode is for the bulk case.

What the offers *do* carry is whatever the platform itself says about listings on it: its **default
listing type** and, on an auction platform, its **default starting price**. Quick mode never asks
those two questions, so the platform's own answers stand — exactly as they would if you had opened
the create form and left both fields alone. Both are set on the
[platform](platforms.md#offers-and-sales).

Press **Done** (or the button at the top again) to leave. Two things to know:

- The mode is **not remembered**. It is off every time you open the list, so a click can never list
  something without asking on a screen you have just opened.
- A platform with **no currency set** cannot be used here — its currency is fixed the first time
  something is listed on it, and that choice belongs in the create form. The bar says so, and the
  ordinary dialog stays in effect until you pick a platform that has one.

#### Generating offers in bulk

After a large intake, clicking through every set and every loose stamp is still a lot of clicks.
**Generate offers…** in the quick offer bar makes all of those offers in one pass, on the bar's
platform and in its status, and shows you every one of them before anything is created.

It works on **what you can see**: the copies you have ticked in view, or — when nothing is ticked —
every copy the list's filters show. A copy a filter hides is never used.

Two choices:

- **What to list.**
  - **Complete sets** — every [checklist](collections.md#checklists) the copies complete becomes a set holding one
    copy of each of its stamps. By default a set is one condition, one certificate status and one
    format: a checklist that could only be completed by mixing them forms no set. A variant fills its
    parent's place when the parent itself is missing. Where one copy could complete two checklists,
    the checklist that comes first on the issue gets it.

    **One-stamp series count as complete sets** — beside *What to list*, on when the dialog first
    opens and remembered in this browser afterwards. On, a checklist of a single stamp is a complete
    series like any other: each copy of its stamp is a set of its own, offered with the other complete
    sets and under the same rules — one condition, certificate and format (or mixed, as below), a
    variant filling its parent's place, identical sets packed together. So if you list only complete
    series, *Complete sets* alone covers your one-stamp issues too. Off, a checklist of a single stamp
    is not a set and its copies are left to *Singles*, as before. The switch decides what both choices
    list: on, *Singles* no longer offers those copies, so running both still makes one offer of each.

    **A set may mix** — the same switches as on [Series from Singles](offers.md#series-from-singles):
    **Conditions**, **Certificates** and **Formats**, each on its own (*Certificates* and *Formats*
    only appear when the collection defines any). With *Conditions* on, a checklist you hold one stamp
    MNH and the other eleven MH becomes one set instead of twelve singles; the other two axes still
    have to agree unless you switch them on too. All three are off when the dialog opens. With any of
    them on, choose which sets come first:
    - **Same value first** (the default) — sets complete in one condition (certificate, format) are
      formed first, exactly as without mixing, and only the copies left over are combined into mixed
      sets. A mixed set leans to the value most of it shares: eleven MH and one MNH, not six and six.
    - **Mix freely** — sets are formed in the usual order, lowest copy numbers first, whatever their
      value: whatever completes a set does, pure or mixed.

    The switches belong to *Complete sets*; *Singles* lists what it always did.
  - **Singles** — every copy **left over** once the complete sets are taken out becomes a set of its
    own. A copy that belongs in a complete set is never offered as a single, so it does not matter
    which of the two you run first. A cover or other piece with several stamps is always an offer of
    its own.
- **How to pack identical sets.**
  - **Multi-quantity** — identical sets (the same stamps, in the same condition, certificate status
    and format — for a mixed set, every stamp in the same one as in the other) share one offer, with one set per copy of the set. On a platform that lists an
    unidentified variant under its cheapest one, "the same stamps" means what each copy
    [will be listed as](#the-same-stamp-in-the-same-condition): a `523` copy that goes on Colnect as
    `523I` packs with the `523I` copies, since two offers of it would be refused. If an offer on that platform —
    Preparing, Ready, Active or Paused — already lists exactly those stamps in those conditions, the
    sets are **added to it** instead of making a second one. With several such offers the
    lowest-numbered is proposed, and you can pick another. An Active or Paused offer that receives
    sets is marked as [changed after listing](offers.md#keeping-platforms-in-sync--needs-action), so it turns up in *Needs action*. An offer in
    **active bidding** never receives sets: a new offer is made instead, and the preview says why.
    On Facebook only an offer **in the group chosen in the bar** receives sets; one in another
    group is left alone and a new offer is made in the chosen group.
  - **Separate offers** — every set becomes a new offer of its own, even where a similar offer exists.
  - **One of each** — of identical sets (identical as *Multi-quantity* reads it) **only one is
    listed**, as a new offer of its own; the rest stay where they are and are not handed to the other
    mode either. Sets that differ in condition, certificate status or format are not identical: two
    sets in one condition and a third in another make two offers. The set listed is the one with the fewest copies
    already in an open offer on another platform, then the one with the lowest copy numbers. Where an
    identical set is **already in an open offer on this platform** — bidding or not — no offer is made
    for it at all. It works the same in *Singles*: of identical singles one is listed. The line under
    the count says how many identical sets were left out and how many are already listed.

  The choice is remembered for the next pass in this collection.

The preview lists every offer on **one line**: its name, the condition
in its colour — with the certificate status and format only when there is one; a mixed set names
each value with how many of its copies are in it, *MH ×11 · MNH ×1* — the set by its
catalogue numbers, run together as a range where they follow on (`Mi·PL 865-870`), any variant
standing in for its parent, how many sets (`×3`), and whether it is a **new offer** or **added to
#N**. Hover *added to #N* for the offer's name and how many sets it will then have. Click a line to
open it: each set's copies as full copy rows — photo, catalogue numbers, condition, storage location
and the rest, as the Copies list shows them — so a set can be checked against the stamps on the desk.
The dialog takes the width of the window, so a long pass reads as a table.

Every line is named by its issue first, in the collection's default language. A set adds its
checklist's name — `Adolf Hitler (II) · Perforation 14` — and a checklist named exactly as its issue
is named once: `Adolf Hitler (I)`. A single stamp adds its own name where it has one —
`Polish Castles · Malbork`, or just `Polish Castles`. A piece with several stamps keeps its own name.
A stamp with neither an issue name nor a name of its own shows no name: its catalogue numbers say
what it is.

A copy of a ticked offer that is **already in an open offer on another platform** is shown on that
offer's own line, not in a list of its own — a pass of hundreds of offers would otherwise list
hundreds of copies before its first offer. **One line above the list** counts them: *636 copies in 210
of the offers are already in an open offer — 590 can be swapped for a copy listed nowhere*, with
**Swap all (590)**. **Each line holding such copies carries a marker** beside its name — how many and
the platforms they are on, *2 on Colnect* or *4 on Colnect, Allegro*; a line with none has no marker.
Click the line, or its marker, to open it: under each such copy, the open offer it is on (*On Colnect
#3196*), and the copy of the same stamp listed nowhere with **Swap**, or *no other copy to swap in*.
A swap makes the plan again with that copy in its place; the marker and the count above the list
follow at once, and the line stays open. Only ticked offers are counted and marked. See [A copy
already listed elsewhere](offers.md#a-copy-already-listed-elsewhere).

**Every proposed offer has a tick box, and all of them start ticked.** Untick an offer to leave it
out of this pass; the box at the top of the list ticks or unticks them all at once. Only the ticked
offers are created, and the button (*Create 12 offers*) and the count above the list follow the
ticks. Leaving an offer out does not hand its copies to another offer — they simply stay where they
are, and the line under the count says how many copies in how many unticked offers that is. Run the
pass again later to list them.

Above the list it also counts the copies it left out and why — already offered on the platform, not
for sale, not in hand, set aside from the platform, in an offer in active bidding, or no longer held —
and how many copies the other mode would list.

The new offers are created exactly as quick offer mode creates them: no asking price, no listing URL,
titles and descriptions from the platform's templates, and **Preparing** — each is marked ready and
published on its own afterwards.

**On Facebook, the new offers go straight into a new post.** **In a new post** starts ticked and the post's **title** is suggested from what the new
offers hold: the deepest area holding every copy and the span of their issues' years —
*Generalgouvernement 1940–44*, or *1940–44* alone when the copies share no area. The suggestion
follows the preview — a change of what to list, an offer ticked or unticked — until you type in the
field; from then on your title stands. The offers the pass creates become the [lots of one new post](facebook.md#a-post-with-several-lots) in the bar's group,
in the order the preview lists them — each new offer's line says which lot it will be — and the
button reads *Create 12 offers in a new post*. Only offers the pass **creates** join the post: an
existing offer that receives sets stays where it is, in its own post or none. A post needs at least
two lots, so where the pass would create only one offer the option starts unticked and says why. The
message after the
pass has **Open post**, the post's screen, where the lots are priced and put up together — no
*Post together…* afterwards. The auctions among them share one closing time, as in any post.
Untick it and the pass makes no post; on any other platform the option is not there.

**A group's limit on lots splits the batch into several posts.** Beside the title, **Max lots per
post** starts at the group's [own setting](facebook.md#several-lot-posts) and can be changed for this
run alone — the group's setting stays as it is. Empty is no limit: one post, as above. With a limit,
the new offers go into as many new posts as it needs, in the preview's order, and you choose how:
**Fill to the limit** (chosen when the dialog opens) gives each post as many lots as the limit allows
and the rest to the last one — with a limit of 40, 85 offers become 40, 40 and 5 — while **Even**
makes the fewest posts the limit allows with the lots spread evenly — 29, 28 and 28. The posts take
your title with *(1/3)*, *(2/3)*, *(3/3)* after it; a pass that fits in one post keeps the title as
typed. Each post's lots are numbered from 1, and each new offer's line says *post 2 · lot 5*. The
summary and the button say how many posts will be made, and the message after the pass opens the
first of them. Only the new offers count towards the limit.

Confirming creates **all of the ticked offers or none of them**. If anything changed since the
preview in a ticked offer — a copy sold or went onto another offer, or an offer due to receive sets
changed status — nothing is created and the message names the copy or the offer. The same holds for
the new post: if it cannot be made, neither are the offers. Look at the preview
again and confirm once more. A change among the copies of an unticked offer does not stop the rest,
since nothing of that offer is created.

## Bulk editing the selection

**Bulk edit…** in the selection bar changes **where the picked copies are kept**, **what they are
kept for** and **what they are**, in one dialog. It is the fast way to re-organise physical storage
after a re-shuffle, to re-flag a batch you have just decided something about ("all of these are for
trade now"), or to correct a batch that was recorded wrong ("these are all mint, not used").

Every section is optional and every one starts on **Leave as is**, so the dialog is equally the
*move* action, the *re-flag* action and the *re-grade* action. Nothing you leave alone is written at
all — every copy keeps everything the dialog does not name. **Apply** stays greyed out until you
have said something.

The dialog is wide, its sections in two columns so they all fit on screen at once: what the copies
**are** on the left — condition, certificate and format, faults, value reduction — and what is
**done** with them on the right — storage location, disposition, tags. Each section carries one
short line; hover the ⓘ beside it for the rest.

**Storage location** has three settings:

- **Leave as is** — the copies stay where they are filed. The line underneath tells you what that is
  today ("Filed across 3 locations, and 4 not filed at all").
- **Move to…** — pick a [location](locations.md) from the tree and every picked copy is filed there.
  Only locations that can hold copies are selectable, exactly as in the copy form.
- **Clear** — takes them out of storage entirely: location and ref both cleared.

While you are moving copies, a **Ref** box appears under the location. Fill it in and every picked
copy gets that ref — the card they now sit on inside the location. **Leave it blank and the refs
they carry now are cleared**, because a ref addresses a place inside the location they are leaving.

The box is not empty: it is the **same field the Store dialog uses** when you put a purchase away
(see [The ref](purchases.md#the-ref)), so you never have to remember where a box's numbering stood.
It opens on **the card that location is currently up to** — the counter belongs to the location, not
to what you are filing — and press **Next ref** when that card is full to have the first unused
number filled in. Both are suggestions: the field stays yours to edit. Pick a different location and
the suggestion follows it, unless you have typed a ref of your own, which always stands.

A location nothing has ever been ref'd in offers nothing and stays blank, which is the normal case
for an album or stockbook, and there is no **Next ref** to press. Under the box, the same strip of
three figures as in Store — *On A147 now 12 · Adding 5 · After 17* — says how many copies the card
holds now, how many go on, and how many it will hold after; picked copies already on that card are
not added a second time. Filing onto a ref **already in use** is not an error: on the card that
location is up to the strip carries a quiet tick, and on any other ref it turns into a warning,
which is what catches a typo.

**Leave as is** and **Clear** write no ref at all, so neither suggests anything.

**Disposition** carries all three flags — *In collection*, *For sale*, *For trade* — each with its
own **Leave as is · On · Off**. They are independent (a copy can be in the collection, for sale and
for trade at once), so answer as many as your change needs: moving a drawer from stock to swaps is
*For trade → On* **and** *For sale → Off*, set together and applied in one go. Every flag left on
*Leave as is* is not written at all, so a mixed selection keeps whatever those flags said. Beside
each flag you answer, the dialog says how many of the picked copies are already like that.

**Condition, certificate and format** heads the left column: one dropdown each, every one starting on
**Leave as is**. Pick a value and it is written on **every** picked copy, whatever that copy reads
now — this is the correction of a batch recorded wrong, not a filter. As with the flags above, the
line beside each dropdown says how many of the picked copies already read that way, so you can see
whether you are about to change anything.

- **Condition** offers your collection's grades. There is no "none": a copy is always in some
  condition. Catalog values are looked up per condition, so a re-graded copy is valued against its
  new grade from then on.
- **Certificate** offers **No certificate** alongside your collection's statuses — picking it takes
  the certificate off the copies.
- **Format** offers **Single** alongside your collection's formats — picking it records the copies
  as ordinary singles rather than pairs or blocks.

The certificate and format rows appear only once your collection defines some.

**Value reduction** sets one percentage on every picked copy (**Set to…**), takes the reduction off
them (**Clear**), or leaves each copy's own (**Leave as is**). The line under it says how many of the
picked copies already have one (*None has a reduction yet*, *2 of 5 have a reduction*). See
[Lowering a copy's value for its faults](#lowering-a-copys-value-for-its-faults).

**Value modifier** works the same way: **Set to…** writes one percentage, amount and note on every
picked copy, **Clear** takes the modifier off them, and **Leave as is** leaves each copy's own. See
[Adjusting a copy's catalog value](#adjusting-a-copys-catalog-value).

**Faults** works the same way as the tags: **Add** puts the [faults](faults.md) you name on
every picked copy, **Remove** takes them off, and every fault you do not name stays where it is.

**Tags**, at the foot of the right column, are worded as two verbs rather than as a value:

- **Add** puts the tags you name on every picked copy. A copy already carrying one is left as it is.
- **Remove** takes the tags you name off every picked copy. A copy not carrying one is left as it
  is.

**Every tag you do not name stays exactly where it is on each copy.** There is deliberately no way
to set the tags to one list: a copy carries any number of [tags](tags.md), so one pass over a mixed
drawer would otherwise flatten forty copies onto whatever the dialog happened to show. A tag you
have ticked to add is not offered under *Remove*, and the other way round, so the two cannot
contradict each other.

Beside each you answer, the dialog says what it would reach — how many of the picked copies already
carry everything you are adding, and how many actually carry something you are removing. If your
collection has no tags yet, the section says so and links to Settings.

Applying acts on every ticked copy, clears the selection (what has been dealt with should not invite
doing it twice) and confirms with a toast — worth having on this list, where a moved or re-flagged
copy often lands outside the filter you are looking through.

## Selling copies without an offer

Copies that were never listed can still be recorded as sold — a stamp someone asked you for, one
sold at a fair or to a friend. Tick them and choose **Sell…** in the selection bar (or in the
[selection menu](#the-selection-menu-on-a-ticked-row) on a ticked row). It reaches the ticked copies
in view that are **in stock** — in hand, not sold, not traded away, not disposed of — whatever they
are kept for; when only some are, the button says how many, *Sell 3…*.

The dialog asks for the **price for the set** first: the copies become **one set on the sale with
that one price**, and no offer is made for them. Then pick one of the **open sales** — ordered, paid
or packed, newest first, each with its buyer, platform and currency, the price being in that sale's
currency — or **Create new sale**, whose platform decides the currency as usual. Sales already sent
are not offered. On the sale the set reads *on no offer* on the **Sold units** list.

**The list stays where it is.** Its search, filters, sort and place are kept; the sold copies leave
it or change their state as the filters say, and their ticks go — any other ticked copies stay
ticked. A message says where they went, *3 copies added to sale #45 — Mieczyslaw Mum, Facebook*
(*new sale #46* for one made in the dialog), with **Open sale**. The next **Sell…** starts with
that sale at the top, marked **Last used**, while it is still open: type the price and press
**Enter** to add the copies to it, so a run of copies to one buyer needs no picking.

A ticked copy that is also in an offer can be sold this way; that offer is then flagged **Needs
action**, as when a copy sells under another listing. Removing the set from the sale puts its copies
back in stock. The same can be done from the sale's own screen with **Add copies** — see [selling
copies that are on no offer](sales.md#selling-copies-that-are-on-no-offer).

## A collage of copies for a buyer

A buyer asks whether a series or a few stamps are still there, and there is no offer to show them.
Tick the copies and choose **Make collage…** in the selection bar (or in the [selection
menu](#the-selection-menu-on-a-ticked-row) on a ticked row). It reaches every ticked copy in view.

The dialog holds an offer's [photo settings](offers.md#photo-settings) — sides to photograph, tile
labels, single photos, series on their own photos, covering symbols and the collage numbers with
**Copy from template** — and makes the pictures by the same rules an offer's photos follow. Two
choices head it:

- **Settings from** — the platform the settings start from, as a new offer there would start. Its
  photo limits apply too: the longest edge and file size, and how many photos it takes, which is
  what *single photos* spends. The platform last used is offered.
- **The N copies** — **as one set** (a series or a lot: *group series on their own photos* is what
  applies) or **each copy on its own** (*single photos while the limit allows* is what applies) —
  the same two ways the *New offer* buttons make an offer of ticked copies.

**Make collage** shows every image it made, each with a **Copy** button that puts it on the
clipboard to paste into a conversation, and **Download** saves the image — or, for several, one ZIP
of them all. Covers already drawn on a copy's photos are used when the platform (or the dialog)
covers symbols; a photo never checked for symbols is drawn as it is, and the preview says how many.
The stamps are drawn [at the same scale](offers.md#every-stamp-at-the-same-scale) as on an offer, and
the preview names the photos with no [scale](#a-photos-scale) when some are on an image with others —
click the count to [give them one](offers.md#giving-photos-a-scale-from-the-offer), then **Make it
again** in the confirmation to see the collage redrawn.
A side the copies have no scan of, and an image past the platform's photo limit, are named there as
on an offer.

**Nothing is kept**: no offer is made and no picture is stored — closing the dialog lets them go.
The settings you last made a collage with are remembered in this browser, so the next one starts
from them; **Back to settings** returns to them to try again.

## Grouping the list

The toolbar's **grouping** dropdown collapses the list into groups. There are four, and they answer
different questions:

- **Group duplicates** — what stock do I hold several of? (below)
- **Group by location** — what is in this box? ([Grouping by where copies are
  filed](#grouping-by-where-copies-are-filed))
- **Group by location ref** — the same, split down to the ref written on the shelf.
- **Group by issue** — what have I got of this series? ([Grouping by
  issue](#grouping-by-issue))

The dropdown also carries the three **Split by …** switches that duplicate grouping uses (below).
They are in there from the moment it opens, under a heading saying when they apply, rather than
appearing on the toolbar once you have picked *Group duplicates* — so you can see what duplicate
grouping offers before choosing it, and picking a grouping never moves the controls beside it. They
are greyed while another grouping is in effect, because they only ever change what counts as a
duplicate. With one on, the closed dropdown says so (*Duplicates + condition*); with more, it counts
them (*Duplicates + 2 splits*).

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

**Covers and other pieces** — several stamps, or one on a format of kind *On cover* or *On piece* —
are listed under none of their stamps. Grouped by duplicates or by issue, they are collected into one
**Covers and pieces** row at the very end of the list — a cover franked with three stamps is not a
duplicate of the first one, nor a copy of the first one's series, and a cover franked with one is no
copy of that stamp either.
It opens, ticks and expands like every other group row. Grouped by location or ref they are filed
exactly like any other copy, since where a piece is kept is a fact about the piece.

## Grouping duplicates

When you hold several copies of one stamp, the interesting row is not the copy — it is the
**stack**. Pick **Group duplicates** and the list collapses to one row per stamp, with its count up
front (`×10`). Expand a row (the **caret**) to see the individual copies underneath.

**The conditions sit beside the count.** A stack held in one condition shows that condition, as a
copy row does. A stack held in several shows each with its count — `MNH ×2` `MH ×1` — because
which conditions you hold a stamp in is often exactly what you grouped the list to find out. The
format and the certificate join them when you have split by those. The rest of the row describes the
stamp, exactly as an ungrouped copy row does. A last line appears only when the group has something
extra to say — that it is mixed, or that some of its copies are already listed — so a plain stack is
one line shorter than one that needs a warning.

Two copies count as duplicates when they are the **same stamp**, whatever their condition. A piece —
several stamps, or one on a cover — is never a duplicate of anything: it goes in the **Covers and
pieces** row at the end.

Three switches, inside the grouping dropdown, each add an axis to that rule:

- **Split by condition** — copies in different conditions become different items. This is the
  reading for **choosing what to sell**: Colnect refuses more than one offer for the same stamp in
  the same condition and expects a quantity offer instead, so a stack you mean to list there as one
  quantity should be one condition. It used to be the only way duplicates were grouped; it is now
  off unless you turn it on.
- **Split by format** — a pair or a block becomes a different item from a single, rather than
  joining the same group. Only shown once your collection has [formats](#pairs-blocks-and-other-multiples).
- **Split by certificate** — a certified copy becomes a different item from an uncertified one. Only
  shown once your collection has certificate statuses.

They stay visible under every grouping and are greyed unless duplicate grouping is the one in
effect. A switch you left on keeps showing as on while it is greyed: it is waiting for the next time
you group duplicates, not silently applying to the grouping you are looking at.

To see only the stacks — or only the singles — use the **Held** filter on the toolbar
([Filters and sorting](#filters-and-sorting)): *Held more than once* keeps the rows counted `×2` or
more, under whichever switches are on.

Leave them all off and you get the plain rule: one row per stamp. Turn all three on and each group
has one unambiguous per-copy **catalog value**, because the key is then exactly what a catalog price
is recorded against. A group whose members value differently — an MNH and a used copy, say — shows
*varies* instead of a figure.

Where members disagree on an axis you left off, the row says so — **mixed conditions**, **mixed
formats**, **mixed certificates**. With that axis switched on, the marking cannot appear: the copies
are in different groups.

Grouping and filtering are **different questions** and both apply. The sidebar and toolbar filters
decide *which copies you are looking at*; the toggles decide *what counts as the same item*. Grouping
**never changes which copies are shown** — it used to cover only copies you could still list (*For
sale*, delivered, unsold), which greyed out the *Include sold & traded* and delivery-state controls;
it no longer does, so every filter stays live and works the same way it does in the other grouping
modes. The one control that *is* replaced is the sort: groups are ordered by **how many copies each
holds**, largest first.

A group can therefore hold copies you cannot list — one still in transit, one not marked for sale.
That does not get in the way of listing the rest: tick the group and the **Add selected to offer**
buttons act on the copies that qualify and say how many that is.

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
blocks and one plain single, the single is the exception, not the blocks; in a stack of five MNH
copies and one used, the used copy is. Where no condition is in the majority — two MNH, two used —
nothing is marked and **Select all** ticks the lot, so for a listing that has to be one condition,
turn on **Split by condition** first.

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
- Like every grouping, this covers **whatever the list is showing**. Every filter still applies
  — including *Include sold & traded* and *Include no longer held* — because "where is it?" is a fair question
  about a copy you have already sold but not yet posted.
- The **checkbox** in front of a group row ticks the copies filed there that you still hold, exactly
  as it does on a duplicate group.

Both groupings are computed on the server, so a group is never split in half by scrolling. The
[sort](#filters-and-sorting) orders the copies inside each group; the groups stay in shelf order.

## Grouping by issue

**Group by issue** collapses the list to one row per [issue](collections.md), over the copies you
hold of it — the reading you work a series through, and the one that shows at a glance where a set is
thin. Rows are in the **Issues list's own order**: by year, then by the issue's primary catalog
number, then by name. An issue with no year comes after the dated ones, and the copies whose stamp
belongs to **no issue** are the last row of all. The [sort](#filters-and-sorting) orders the copies
inside each issue; the issues stay in this order.

Like every other grouping, this covers **whatever the list is showing** — every filter still
applies, *Include sold & traded* and *Include no longer held* among them, because "what have I got of
this set" includes the piece you have already sold. The **checkbox** in front of a group row ticks
the copies of that issue you still hold, and the grouping is computed on the server, so a group is
never split in half by scrolling.

A stamp can belong to more than one issue. A copy is counted under **one** of them — the first issue
its stamp was added to — so the counts add up to the list exactly rather than reporting one copy
under two series. A **piece** — several stamps, or one on a cover — is counted under none of them, in
the **Covers and pieces** row after *no issue*; with it, the counts still add up to the list.

### How complete each set is

Under the issue's name, the group header says how far its [checklists](collections.md) have got,
**condition by condition** — `MNH 3/5`, `U 5/5`, one chip per condition you hold something of. A
condition you own the whole set in is **filled green and ticked** (`✓ U 5/5`), so the finished ones
jump out of a long list without your reading each fraction. Conditions you hold none of get no chip
at all: the ones on the line are the ones there is something to say about.

The line opens with **Any** — how many of the set's stamps you hold **in any condition**, set apart
from the condition chips by its bold label and a thin rule after it. It is the figure for a set you
would sell complete in mixed conditions: one stamp in MNH and the other eleven in MH reads
`Any 12/12 · MNH 1/12 · MH 11/12`, and a set complete in any condition is ticked green the same way.
It counts the same copies the condition chips do, so with the list filtered to one condition it
agrees with that condition's chip. Its hover gives the same two figures as the others.

Hover a chip for the figures behind it: the checklist and condition it is talking about, then
**Held** (the same fraction the chip shows) and **how many complete sets** you could assemble from
those copies — the figure that says whether a duplicate is a spare or the only one you have. The two
figures are set out one per line with the numbers aligned, so they read at a glance; the note about
what is being counted follows underneath.

These figures are counted over **the copies this list is showing**. Every filter in force applies, so
a list narrowed to one klaser tells you how complete the set is *in that klaser* — not how complete
it is across the collection. That is deliberate: a header describes the rows underneath it. Clear the
filters to read the whole collection's answer, or open the issue's own page for the full
[completeness grid](detail-pages.md#completeness), which breaks the same question down by disposition and format
as well.

A copy filed under a **variant** of a stamp on the checklist counts for that stamp, at any depth —
the same rule the issue's own [completeness grid](detail-pages.md#completeness) states in full.

An issue whose checklists you hold nothing of shows no chips, and so does the **no issue** row: a
bucket of copies is not a set that can be complete. A piece carrying several stamps ticks none of
them off here either.

To see only the finished sets — or only the unfinished ones — use the **Complete** filter on the
toolbar ([Filters and sorting](#filters-and-sorting)): it keeps exactly the groups whose chips say
so. A copy that *might* be of an issue (the *+n possibly* figure) is not settled into it, so the
filter leaves it out.

## Seeing what a stamp is worth

Every copy row's **⋮** menu has a **Show valuation** action. It opens the read-only **Valuation**
dialog for the stamp this copy is of — what the market has paid for it, what you have paid for the
copies you hold, and what the catalogs list it at. It is the same window the **Stamps** and
**Issues** lists open, and it changes nothing: close it and you are back on the list, in the same
place. See [The Valuation dialog](collections.md#the-valuation-dialog).

On a piece carrying several stamps the same action opens **that piece's** window instead — the value
you recorded on it and the sum of its stamps, which is the one place that value is set. See [What a
piece carrying several stamps is worth](#what-a-piece-carrying-several-stamps-is-worth).

This is not **Edit stamp**, which is on the same menu and opens the stamp *editor* — use that one
when you want to record a catalog value rather than read one.

## Seeing which offers something is in

Every copy row's **⋮** menu has a **View offers** action. It opens a read-only popup listing
**every offer that references this copy**, across all platforms — live listings first
(**Active**, **Paused**), then the ones you're still preparing, then the closed ones (**Sold**,
**Withdrawn**). A copy you have never listed says so.

You rarely need to open it to know whether a copy is listed: **a copy in an open offer carries a
chip on its row** — on the Copies list and in every copy picker (*New lots…*, an offer's **Add
set**, **Attach existing copies**, the sale's and trade's pickers, and the rest). With one open
offer the chip names it by platform and number (*Facebook #3012*); with several it says how many
(*On 2 offers*). Open means anything but **Sold** or **Withdrawn**, so a copy in a **Preparing**
offer is chipped too; the chip takes the colour of the furthest-along offer, so a live listing
stands out from one still being prepared. Hover it to see every offer with its state, and click it
to open **View offers**. A copy in no open offer shows nothing. In a picker opened from an offer, a
proposal or a post, that screen's own offer or lots are left out of the chip — a copy already in
them is what you are editing, not a listing elsewhere. Pick a copy without the chip where you can:
when one listed elsewhere sells, the other offer has to be closed by hand.

A row of **state chips** sits over the offers — one per state they are in, with its count — and
the popup lists the offers in the states switched on. **Sold** and **Withdrawn** start off, so
what you see first is what is still open; click a chip to switch it on or off, any number at once.
When the chips hide every offer the popup says what is hidden (*2 sold, 1 withdrawn hidden*). The
choice is remembered for the collection and is the same one the
[Offers card](detail-pages.md) on a copy's, a stamp's and an issue's page uses.

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

Once a copy has been [listed on an offer that covers symbols](offers.md#covering-symbols), its page
shows **Offer covers** on the Photos card: tick it to see the covers laid over the photos, and click
a photo to change them. The photo itself never changes — covers are only drawn into offer images.

Accepted formats are **JPEG, PNG, and WebP**, up to **200 MB** each. Each photo is
automatically downscaled for storage and given a thumbnail for the list and slot views.

### A photo's scale

While you are adding photos, **Scanned with** under the strip says what they were scanned with — one
of your [scanning profiles](collections.md#scanning-profiles), the default one to start with,
**Another resolution…** to type the dots per inch, or **No scale** for a picture that is not a flat
scan, such as a phone photo. It applies to every photo added in that sitting, and is what lets
[offer collages](offers.md#every-stamp-at-the-same-scale) draw every stamp at the same scale. It is
never read out of the file. The scale is the scan's as you uploaded it, so making the photo smaller
for storage does not change what it measures. Tiles cut from a [card
scan](purchases.md#working-through-the-tiles) carry their card's profile and need nothing.

A photo that was **never given a scale** — every photo added before scales existed, and any added
somewhere that does not ask — is taken at the collection's **default** [scanning
profile](collections.md#scanning-profiles), whatever the default is when a collage is drawn. Only a
photo marked **No scale** has none.

The Photos card of the copy's page names each photo's scale under the strip — *Front: Epson V600, 1200
dpi* — and one taken from the default says so: *Back: Epson V600, 1200 dpi (default)*. To change one,
press **Scale** — it reads *Scale (2 without)* while some photos are marked No scale — and pick one for
each photo; **Collection default** puts a photo back to taking the default. For many copies at once,
tick them on the list and choose **Photo scale…** in the selection bar: the photos of those copies
that were **never given a scale** are all given the one you pick, and a photo with a scale of its own,
or marked No scale, is left as it is. Opening a photo to measure it starts on the profile its scale
comes from.

**A scan that came out sideways is put right as you add it.** A photo you have just dropped carries
a turn button beside its **✕**: each press turns it a quarter to the right, and the card shows it the
way it will be saved. The turn is written into the photo when you **Save** — the photo and its
thumbnail are stored the right way up, so it shows that way everywhere, in offers and listings
included. A photo that is already saved has no turn button; remove it and add it again. (Tiles cut
from a [card scan](purchases.md#working-through-the-tiles) are turned in the tile's own dialog.)

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

1. On an unknown-variant row, open the **⋮** menu and choose **Identify variant**. The
   dialog shows the copy's **front** and **back** photos on the left, beside the variants, so
   you can look at the piece while you choose; click either one to open it full size. A copy with neither photo
   says so — add one with **Edit** first if you need to see it.
2. Pick the specific variant from the list — only the variants of that copy's own stamp
   are offered, so you can only refine to a *more specific* variant, never re-point the
   copy to an unrelated stamp.

   To lay the copy against the reference photos of its stamp and of the variants and forgeries
   under it, use **Compare with references…** above the list — it opens on the variant you have
   picked, if any. See [Comparing a piece with a reference](purchases.md#comparing-a-piece-with-a-reference).

3. Optionally add a **reason** (for example, what let you tell the variants apart).
4. Click **Identify variant**. The copy is re-pointed to the chosen variant, the
   *unknown variant* flag clears, and the change is recorded in the copy's refinement
   history.

## When the piece could be one of several stamps

Sometimes you can narrow a copy down without being able to say exactly which stamp it is. The type
is clear but the colour is not, so it is *123aI or 123bI*. Or the watermark that decides between two
catalogue numbers in different issues cannot be read on a cover, so it is *Mi 85 or Mi 101*. Linking
the copy to the base stamp would throw away what you know, and picking one would claim what you do
not. Record the possibilities instead:

1. Next to the stamp in **Add copy**, **Edit copy**, **Identify variant** or the stamp picker when
   identifying card scans, choose **Several possible variants…**.
2. The usual stamp browser opens and stays open. Press every stamp the piece could be — from one
   issue or several. Each press adds the stamp to the list beside the tree, and pressing it again
   takes it off.
3. Choose **Use these** once at least two are listed, then save.

Ticking every variant of one stamp is the same as saying *some variant of it*, so the copy is simply
linked to that stamp, as an unknown-variant copy is.

Such a copy:

- is named by its possibilities everywhere — *Mi 123aI or 123bI* on the Copies list, on its own page,
  in offers and in trades, including the page you share with a trading partner. A long list is
  shortened to the part the stamps share and the parts that differ;
- is marked **variant to settle**. The Copies list's **Show only → Variant to settle** filter finds
  these copies together with unknown-variant ones;
- is valued at its **cheapest** possibility, shown as an estimate. On an offer it is listed under that
  cheapest stamp, and the listing text names the possibilities;
- satisfies no want and is not offered for a trading partner's request for a stamp, since it might be
  the other one. You can still put the copy itself into a trade;
- when its possibilities share a stamp (*123aI or 123bI* share *123*), counts as an unknown-variant
  copy of that stamp. When they do not (*Mi 85 or Mi 101*), it counts towards no set's completeness
  and no copy count until you settle it, and is shown under **each** possibility as *possibly* — in
  a stamp's and an issue's **Copies** card under *Possibly this stamp*, on the Copies list grouped by
  issue as *+1 possibly* beside the issue's own count, and as a muted *(?1)* on the stamp's copy
  count. It is still counted once in your collection's value.

A copy carrying several stamps — a cover with three different stamps on it — cannot be given
possibilities. Note the doubt in the copy's notes instead.

### Settling it later

Open **Identify variant** from the copy's **⋮** menu or its page. The possibilities are listed first:
pick the one it turned out to be and save, and the copy becomes an ordinary copy of that stamp, with
the change in its refinement history. If you can rule some out but still not decide, choose **Narrow
the possible variants…**, take off the ones it cannot be, and save.

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
