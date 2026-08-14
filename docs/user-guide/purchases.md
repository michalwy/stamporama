# Purchases

A **purchase** records one acquisition — a single event where money changed hands. It is
where your **cost** lives: what you paid a dealer, an auction house, or a private seller,
including shipping. A purchase groups together everything bought in that transaction.

Open the **Purchases** screen from the **Buying** section of the sidebar.

## What a purchase holds

On the purchases screen a purchase is just its **header**:

- an optional **supplier** — who you bought from,
- an optional **platform** — the marketplace or intermediary you bought through (e.g.
  Allegro or eBay), separate from the supplier. So a purchase from *Jan Kowalski* via
  *Allegro* records both.
- the **purchase date**,
- a single **transaction currency** for every amount on the purchase,
- a **shipping / shared cost** (spread across the order's lines by price),
- a **delivery status** (*Preparing*, *In transit*, or *Arrived*).

Every amount field — shipping, lot prices, expense prices — accepts either a comma or a period as
the decimal separator, so `12,50` and `12.50` are both fine.

The order's line items are managed separately, during **lot intake**:

- **Lots** — the *inventory* lines. A lot is a priced parcel — a single stamp, a whole
  series, an album, or a whole box you sort over time. You either leave a lot empty until
  you have sorted it or fill it with individual copies straight away.
- **Expenses** — the *non-inventory* lines. Something bought alongside the stamps that is
  not itself stock — a magnifier, a catalogue, a stockbook: a label and a price. An expense
  absorbs its fair share of the shipping cost so it does not inflate the value of the stamps.

So a freshly recorded purchase has no lines at all — you add them during intake, and its
list total grows as you do.

The one exception is a purchase that came from **settling an auction sale**
([Auction sales](auctions.md#settling-a-parcel-into-a-purchase)). That one arrives with a line per
won lot, priced at hammer plus the seller's premium, and with the lots' contents already identified
as copies — you described them to decide the bid, so nothing is entered twice. It carries a link
back to the sale it came from, beside the supplier in the header. From that point it is an ordinary
purchase: the same sorting, the same lot closing, the same cost basis. Deleting it is also how a
settlement is undone — the bidding record stays, only the link goes.

All amounts on a purchase — the shipping cost and, once added, the lots and expenses — are
in the one transaction currency you pick. If that currency differs from your collection's
base currency, the exchange rate as of the purchase date is captured and stored with the
record.

## The purchases list

Each row shows the purchase's **number** (`#7` — see [Quick jump](quick-jump.md)), the
**supplier** (or *No supplier*, with *via …* when a platform is set), the **date**, the delivery **status**, a
short summary of its lines (how many **lots** and **expenses**), and the **total** — the sum
of every lot, every expense, and the shipping cost, shown in the purchase's currency. A
freshly recorded purchase shows *0 lots* until you add its lines during intake.

- **Filter** by delivery status with the *Preparing* / *In transit* / *Arrived* toggles.
- **Sort** by purchase date or by the date the record was added, ascending or descending.

Your filter, sort, and scroll position are kept in the page URL, so you can bookmark or
share a view. The list loads more rows as you scroll.

## Adding a purchase

Click **Add purchase**. The dialog captures only the header:

1. **Supplier** — start typing to search your suppliers and pick one. You don't have to
   pick: if you type a new name and leave it, it is saved as a new supplier when you save
   the purchase (tagged as a seller, so it is offered again next time). The picker only
   suggests suppliers, so platforms and other contacts never clutter it. Leave it blank if
   the seller is unknown.
2. **Platform** — optional; works the same way, scoped to platforms. Type a new name (e.g.
   *Allegro*) and it is saved as a platform on save, or pick an existing one.
3. **Date**, **Currency**, and **Status** — the date defaults to today and the currency to
   your collection's base currency.
4. **Shipping / shared cost** — optional; spread across the order's lines by price.

Save records the purchase. Its lines — the stamps you bought (lots) and any non-inventory
expenses — are added afterwards during intake.

## Editing and deleting

Use the **⋮** menu on a row to **Edit** or **Delete**.

- **Edit** reopens the header dialog. It never touches a purchase's lots or expenses —
  those are managed during intake.
- **Delete** removes the purchase along with any lots and expenses. This cannot be undone.
  Once lots have been resolved into copies (during intake), a purchase whose lots still hold
  copies cannot be deleted until those copies are detached.

## Intake and the lot lifecycle

Click a purchase row (or **Open** in its **⋮** menu) to open its **detail** screen. This is
where you build up the order's lots and identify copies into them over time.

The header carries a **status** dropdown (top-right). Switch between **Preparing** and **In
transit** and it saves immediately — no need to open the edit dialog. Choosing **Arrived**
opens the **Mark arrived** flow (see *Marking an order arrived* below) rather than a bare
status change, because arriving also moves the order's copies to *To sort*.

Next to the dropdown, a small **→** button advances the status one step along the fixed
progression (*Preparing → In transit → Arrived*) with a single click. It disappears once the
order has **Arrived**.

### Lots

There are two ways to add a lot:

- **Add lot** creates an empty priced inventory line straight away; you then identify copies
  into it over time (see *Identifying stamps* below). Best when you know a lot exists but
  haven't sorted its contents yet.
- **Add lot with stamps** works the other way round: you pick a **stamp or a whole issue**
  first, set its **condition / certificate / location** (with the same optional in-location
  ref and, for a single stamp, photos as ordinary intake — see *Identifying stamps* below),
  then give the new lot its **title
  and price** — the lot is created together with those copies in one step. Best when a lot is
  a single identified item (or issue). Nothing is created until the final step, so backing
  out beforehand leaves no empty lot behind.

A lot can carry an optional **title** (e.g.
*Album Polska 1950s* or *Box lot*) so you can tell lots apart. Leave the title blank and the
lot is labelled automatically from its copies' **catalog numbers** (with the usual vendor
prefixes) — up to three, with *+N more* beyond that — falling back to *Lot 1*, *Lot 2*, …
while it is still empty. Each lot shows:

- its **title** (or the derived label),
- its **price** (in the purchase's transaction currency),
- its **status** — **Open** while you are still identifying copies, **Closed** once its cost
  has been allocated,
- how many **copies** have been identified into it,
- its **pool** — the lot's price plus its fair share of the shipping cost — shown in the
  transaction currency and, when a rate is known, in your base currency. The pool is what
  gets split across the lot's copies when you close it.

A lot's **⋮** menu lets you **Edit lot** (title and price), **Close** or **Reopen** it, or
**Delete** it. Deleting a lot also deletes **all of its copies** — they exist only to
populate the lot, so they are removed with it (you are warned how many when confirming). A
lot's price can only be edited while it is open.

**Catalog value vs. cost.** The whole-order summary at the top of the page, and each lot's
expanded copies, show the same two-line **catalog value / purchase cost** bar as the
[inventory holdings summary](inventory.md) — the summed catalog value (in your base currency,
using each copy's default display condition) next to what was actually paid, so you can compare
paid-against-catalog at a glance. Both lines call out copies that don't fully count: *unpriced*
copies (no catalog price for their condition) and *pending* cost (a copy whose lot is still
open, so its cost-basis is not frozen yet). The order-level bar totals every copy across all
lots; each lot's bar totals just that lot.

**Spent vs. realized.** Once a copy in view has been **sold** ([Sales](sales.md)), three more rows
appear on that same bar — under a rule, because the rows above are what these copies are *worth* and
the rows below what they have *made*. Both levels answer it for their own copies: the order-level
bar for the whole parcel, each lot's bar for that lot alone.

- **Realized** — the sale proceeds of the sold copies, *net*: after the platform's commission, plus
  what the buyer paid towards postage, minus what the shipping actually cost you, all in your base
  currency. Beside it, how many copies in scope have sold — *3 of 10 copies sold*.
- **Net return** — realized minus everything spent on those copies, with a percentage. The spend is
  named on the row, since it is the purchase cost *and* any write-offs together: money spent on a
  copy you have since lost was still spent. (Copies that never arrived are left out of every figure
  here — they cost nothing and can never sell.) This is the *has this parcel paid for itself yet*
  figure, so it stays negative until enough has sold.
- **On sold** — realized minus what those *sold* copies cost, with a percentage. The other question:
  how the sales themselves went, regardless of how much is still unsold. Both are shown because
  neither answers the other.

The figures are live, not final: they move as more sells. Where a sale's copies came from several
different purchases — or from two different lots of one purchase — each copy's share of that sale is
worked out from its catalog price, the same split the sale itself uses. If a copy on such a shared
sale has no catalog price, its share cannot be worked out at all: it is still counted as sold, and
the bar says so (*1 not attributable here*) rather than quietly counting it as nothing.

### Card scans

Instead of photographing each stamp as you identify it, you can **scan a whole stockbook card
at once** and cut the scan into per-stamp **tiles**. Each stamp is then handled physically once
— laid out and scanned — and everything after that happens on screen.

Open a lot and use **Add card scan** in its **Card scans** section.

#### Laying out the card

Lay the stamps on a **black** stockbook card and scan the whole card square-on. Two things about
the layout matter:

- **Leave about one perforation tooth of gap between stamps.** Where two stamps abut teeth into
  teeth, the seam is white paper against white paper: there is nothing there to find, so the two
  will come out as one box and you will have to split them by hand. This is the single biggest
  difference between a card that cuts cleanly and one that does not.
- **Anything joined stays joined.** A se-tenant pair, a block, a strip: it is one piece, so it is
  one box, one tile and — once identified — **one copy with a format**, never several singles.
  That is correct, not a limitation to work around.

Scan at a decent resolution: the scan is cut **before** anything is downscaled, so a card scanned
at 600 dpi gives each stamp its own full-size image rather than a soft fragment of a shrunken
sheet.

#### Cutting the scan

The scan opens in the **cut editor**, over the card itself. Draw a box around each stamp:

- **Drag** on an empty part of the card to draw a box.
- **Click** a box to select it; **shift-click** to add to the selection; drag inside it to move it,
  or drag a corner or edge grip to resize it.
- **Delete** (or Backspace) removes the selected boxes — a shadow, a fibre, the card's own edge.
- **Merge** turns two or more selected boxes into the single rectangle holding them all, for a
  stamp that ended up halved.
- **Split ↔** and **Split ↕** cut one selected box into two: press the button, then click where
  the seam is. The guide line turns red where the cut would leave a sliver, and such a cut is
  refused rather than made.

Each box carries the number it will be created with — rows top to bottom, each row left to right.
**Nothing is created until you press Cut**, so the whole review is free to be wrong. Cancel and
the scan is still stored, waiting to be cut.

#### Backs

To capture backs, **turn each stamp over in place** — do not lift the group or rearrange it — and
scan the card again. Then use **Add back scan** on the batch and cut it the same way.

Backs are matched to fronts **by position**, not by order: each back goes to the front sitting in
the same spot, and the match has to agree both ways. Nothing is mirrored, because turning each
stamp in place is what keeps the positions lined up in the first place.

If the two sides do not have the same number of boxes, that is reported rather than hidden — *Front
12, back 11*, naming which fronts found no back. It usually means a stamp fell out, two were drawn
as one, or the wrong file was uploaded.

A back that finds no front appears in an **unpaired backs** strip below the tiles. Drag it onto the
tile it belongs to. That is also how you handle a card where you only scanned backs for some of the
stamps, or where the layout was not reproduced.

#### Re-cutting

The scan itself is **kept**. If the cut was wrong — and a stockbook that has been broken up cannot
be scanned again — press **Re-cut**: the batch's tiles are thrown away and the editor reopens over
the same card, **with the previous boxes still on it**, so a bad cut is a box moved rather than a
card redrawn.

**Delete batch** removes the tiles *and* the scans. Re-cut is almost always what you want instead.

#### Tiles and closing a lot

A tile is not a copy: it has no stamp, no catalogue price and no share of the lot's cost. The lot
header shows **N tiles unidentified** and the close dialog repeats it, but closing is never blocked
by tiles — the cost split is correct without them. They survive the close.

### Identifying stamps (intake)

A large lot is rarely sorted in one sitting — you identify stamps into it as you work through
the parcel, often long after the money changed hands. Click the lot's **＋ Add stamps** button
(in its header, while the lot is open). This opens the same **browse popup** used across the
app: navigate areas and issues, and either

- pick a **single stamp** (creating the issue/stamp first if needed), or
- add a **whole set** with the button on the issue row — one per
  [checklist](collections.md#checklists) the issue carries, named after it, creating a copy for
  every stamp on that checklist. An issue with a single checklist keeps the familiar
  **+ Whole issue** label.

Expanding an issue whose stamps you want to pick one by one gives you the same **Checklist**
filter the issues list has, so a series collected two ways can be narrowed to the set you are
actually buying. The stamp rows read exactly as they do on the Stamps and Issues lists, the
**copies-held badge** and the **want marker** included, so you can see what you already have
before you even pick.

You are then asked once for the **condition**, an optional **certificate**, an optional
**storage location** — with an optional **in-location ref** (e.g. a page or pocket like
`A234`) once a location is chosen — and an optional **disposition**. Disposition shows the
three flags (**In collection / For sale / For trade**) as chips you click to toggle on the
spot; they preset where each created copy is headed and can be combined. All of these apply to
every copy created in that step. Your last choices — disposition included — are remembered and
pre-filled for the next stamp, so sorting a parcel into the same box, condition, and
disposition is quick. When you are adding a **single stamp** you can also **attach
photos** to that copy right here (front/back plus extra images); a whole-issue intake creates
several distinct copies, so photos are offered only for single-stamp intake.

If your collection defines [formats](inventory.md#pairs-blocks-and-other-multiples) — pairs,
blocks, strips — a
**Format** field sits beside the condition, defaulting to **Single**. A se-tenant pair or a block
of four is one collectible rather than several, and the moment you identify it is the moment you
know which it is; recording it here saves editing each copy afterwards, from memory, once the
sorting pass is over. It is offered for **single-stamp** intake only, the same rule photos follow
and for a stronger reason: a whole-set intake creates copies of many different stamps, and one
format could not be true of all of them. Collections with no formats defined never see the field.

Unlike the choices beside it, the format is **not remembered** — it starts at *Single* every time.
That is deliberate. A stockbook card is often all mint or all used, so remembering the condition
saves hundreds of clicks; multiples do not come in runs like that. If the format stuck, the one
block of four you enter would quietly mark every single after it as a block too, and a format you
never chose is much harder to spot than a missing one, which at least reads as *Single*.

The copies are
linked to the lot and marked **Ordered** — purchased but
not yet in hand, so they are deliberately **not** counted as *in collection* yet. (They
become part of your collection later, once received.) If the order is already **Arrived**
— the usual case when you identify a parcel piece by piece on your desk — the copies start
at **To sort** instead: they are in hand, just not filed yet, so they land beside the
siblings that **Mark arrived** already moved there. Either way they are not *in collection*
until sorted.

**What you already hold.** When you pick a **single stamp**, the dialog names it and adds one line
underneath saying what the collection already has of it — for example
*You hold 2: 1 in collection (MNH) · 1 for sale (U)* — or *You hold none of this yet.* Working
through a stockbook bought sight-unseen raises the same question on every piece (is this needed for
the collection, or is it stock?), and the line answers it without a trip to Inventory and back. The
**conditions** are listed because the count alone settles nothing: two copies mean something quite
different if they are both used. They are *listed*, never ranked — Stamporama nowhere decides that
one condition is better than another (`U` and `MNG` are cancellation and gum, not two points on one
scale) — so the judgement stays yours, and the disposition chips are not touched by any of it: your
remembered choice still stands, because only you know that this whole stockbook is stock. A **whole
set** intake has no single stamp to report on, so the line is offered for single-stamp intake only —
the same rule photos follow.

*You hold* means **copies that have arrived and been sorted**. Copies you have bought but not yet
received are counted too — they are bought, and forgetting them is how you buy the same stamp twice
— but they are said **separately**, after the headline and with their own conditions:

- *You hold none · 1 on its way (MNH)* — a stamp won at auction and still in the post. This is the
  case worth spelling out: the copy is recorded, so a plain count would say *you hold 1* while you
  stand there with the only physical copy of it in your tweezers.
- *You hold 1: 1 in collection (MNH) · 1 being sorted (U)* — *being sorted* is a copy that has
  arrived and is not filed yet, which is both the other parcel on your desk and the piece you
  entered from this very stockbook ten minutes ago. Neither *held* nor *coming*, so it is neither.

Those clauses carry no disposition, because a copy that has not arrived has not been filed anywhere
yet, and they do not say which order a copy belongs to — the useful fact is where it is. The line
counts the **same copies** as the copies-held badge on the catalogue lists (sold copies, copies you
no longer hold and copies that never arrived are left out of both); what differs is that the badge
gives one number and this line splits it, because *hold* is a claim and the badge is a count.

**The want marker.** The same line carries the **crosshair chip** when the stamp is on your
[want list](wants.md), ringed once the condition, certificate and format you have picked would
satisfy one of the wants — all three are axes a want is matched on, so a block of four does not ring
for a want that only ever wanted singles — and it moves as you fill the form. Click it for the terms. The chip is on a lot's copy
rows too, and it is the same judgement the intake review below makes, so a ringed pick is one the
review will greet you with.

**Wants these copies could satisfy.** If any of the copies you just took in matches an open
entry on your [want list](wants.md), Stamporama shows it right after the intake and lets you
**close** the want, **narrow** it (the common case: the want was "anything", a used copy
arrived, so it becomes "any mint"), or **leave it open**. Nothing is closed automatically —
holding a copy is not the same as having what you wanted. Dismissing the dialog changes
nothing.

While the lot is **open**, each copy shows a **live estimated cost-basis** (prefixed with
`~`) — the share of the lot's pool it would receive if you closed the lot right now, computed
from the current copies and their catalog prices. It updates as you add, remove, or price
copies, and is **not** saved; the real cost-basis is frozen only when the lot closes. A copy
with no catalog price (or a purchase with no base-currency rate) shows `cost —` until that is
resolved. The estimate is always computed over the **whole lot**, so it stays accurate no
matter how many copies the lot holds or how far you have scrolled.

**Large lots.** A lot's copies **stream in as you scroll** — the list loads more rows when you
reach the bottom, and the header counts (*to sort*, *unpriced*, *no photos*, the copy total) and the live
estimate are figured over the whole lot on the server. There is no cap: a "stockbook" lot with
thousands of positions shows every copy, and ticking a whole lot or a whole issue group means
**every copy the list is showing** — resolved on the server, not just the rows you have loaded.

**Grouping the copies view.** Above the lots, a **Group by** control has two toggles —
**Lot** and **Issue** — that shape how the whole order's copies are shown:

- **Lot + Issue** (the default) — each lot is a card, its copies grouped by issue inside.
- **Lot** only — each lot is a card with a flat copy list.
- **Issue** only — no lot cards; every copy in the order grouped by issue **across all lots**.
- **neither** — a single **flat list** of every copy in the order, with no lot boundaries.

**Sorting the copies.** A **Sort copies** control next to *Group by* orders the stamps *within*
each lot by **Order added** (the default), **Year**, **Catalog no.**, **Price**, or **Name**,
with an **↑ Asc / ↓ Desc** toggle to flip the direction. It sorts the copies inside a lot (and
inside each issue group, and in the flat / by-issue copy views) — not the lot cards themselves.
Copies missing the chosen field (no year, no catalog number, an uncertain value, no name) always
sort last. Catalog numbers sort naturally (1, 2, 10 — not 1, 10, 2).

Your choice is remembered per collection, and which issue groups you've collapsed is
remembered too, so the view stays the way you left it. In a grouped-by-issue view each issue
appears as a header that reads like a row on the Issues screen (area, title, catalog numbers,
required/total stamp count) and can be collapsed or expanded. **Lot cards themselves start
collapsed** — an order is read as the lots in it, and a lot's copies are a second question. Open
one with its **caret**, or the toolbar's **Expand all** (which becomes **Collapse all** once they
all are). A lot you add while the screen is open opens by itself. **Lot management** (add stamps,
edit price, close/reopen, delete) lives only in a **by-lot** view. Sorting is not lot management,
so **Store** and **Move to location** work in every view — the issue-only and flat views are for
sweeping through copies and sorting them, and that is exactly what those two acts are for.

**How close a series is to a complete set for sale.** In a grouped-by-issue view, each issue
header also carries one figure per [checklist](collections.md#checklists) the issue has — the
answer to *can I list this series as one set yet?*:

- **6/6 — complete** — you hold a for-sale copy of every stamp on that checklist.
- **4/6 — missing 2: Mi 3,7** — you do not, and those are the ones to look for on the next card.
  The numbers are collapsed into runs the way a lot's derived label collapses them, so a gap
  reads *Mi 3-6* rather than as four separate numbers.

How many are missing is **always** printed, because *12/30* and a few numbers still leaves you
counting. And the chip names at most **three** runs before *+N more* — the same three a lot's
derived label shows, and for the same reason: a thirty-stamp series missing eighteen would turn
the header into a paragraph. The **whole** list is in the hover, so a short gap is read in place
while you sort and a long one is one hover away.

The fraction and the missing stamps both range over your **whole for-sale stock** — every
for-sale copy in hand, wherever it is filed, not just the ones in this lot. That is deliberate:
a figure scoped to the lot would report *5/6* about a series whose sixth copy has been in a box
for six months and send you looking for a stamp you already own. Beside it, in muted text,
**· 4 from here** says how many of those came out of *this* lot (or, in the issue-only view,
this order) — which is what tells a series being built out of this parcel, where the last one
may still surface from the copies you have not sorted, from one that was finished months ago.
Hovering the figure spells the range out.

Two things do **not** count towards it. A copy still **ordered** or **in transit** is bought,
and every other count in the app includes it — but a set one copy of which is in the post
cannot go out, so this figure waits for it to arrive (**to sort** already counts: the stamp is
on the desk). And a copy that is not marked **For sale** does not count either, however many of
them you hold: a keeper is not stock. Copies that have sold, or that you have written off, are
out for the same reason.

An issue with several checklists reports each one **separately**, named — a stamp that two sets
share is counted for both, because *is the basic set complete?* and *is the specialized set
complete?* are two questions and one merged figure would answer neither.

Each copy's **⋮** menu also offers **Edit copy** (condition, certificate, storage,
disposition) and **Edit stamp** (the underlying stamp, including its catalog prices on the
**Prices** tab) — so you can correct a copy or fill in a missing price without leaving the
lot.

To remove a stamp from a lot, use its **⋮** menu → **Remove from lot**. Because these copies
exist only to populate the lot, removing one **deletes** it.

### Attaching a copy that already exists

Intake *creates* copies. Sometimes the copy is already there — you entered a piece by hand
before recording the receipt, or you filed one under the wrong order. Use the lot's **⋮** menu →
**Attach existing copies…**.

The dialog is the same picker used elsewhere: areas and years down the left, a searchable list
of copies on the right, tick the ones you want. Attaching changes the copy's **purchase link and
nothing else** — its condition, storage, delivery status, dispositions, photos and
[internal number](inventory.md#internal-copy-number) all stay exactly as they were. A copy
already in hand does **not** go back to *Ordered* because you recorded its cost late.

Two rules follow from cost-basis being frozen when a lot closes:

- **The lot you are attaching to must be open.** A closed lot has already split its pool across
  the copies it held; a copy added afterwards would not be in that split.
- **A copy sitting in a closed lot is not offered.** Moving it out would leave the copies that
  stayed in that lot under-costed. Reopen the source lot first, then attach.

A copy that belongs to **another open purchase** *is* offered, but never moved quietly: the
dialog names the order it would be taken off and asks you to confirm the move before the
**Attach** button becomes available.

### The delivery lifecycle: ordered → to sort → delivered

Each copy carries a **delivery status** shown as a chip on its row, separate from its
disposition (in collection / for sale / for trade). A purchased copy moves through:

- **Ordered** — added during intake to an order that has not arrived yet; bought but not yet
  in hand, so it is **not** in your collection yet.
- **To sort** — the order arrived but this copy still needs sorting; still **not** in the
  collection. Intake into an **Arrived** order starts its copies here.
- **Delivered** — sorted and filed; now counted **in your collection**.

with **Not delivered / missing** and **Damaged** as outcomes you may discover while sorting.

While a lot is open, each copy's delivery-status chip is a dropdown, and a small **→** button
beside it advances the copy one step along the happy path (*ordered → in transit → to sort →
delivered*) with a single click. The button is hidden once the copy is **Delivered** and on
the exception outcomes.

### Marking an order arrived

When the parcel lands, open the purchase and click **Mark arrived** (top-right of the
header). This flips the order's status to **Arrived**, moves every **Ordered** copy to **To
sort**, and — optionally — files the whole order into one location in a single step (e.g. an
*Incoming box*), so nothing is loose while you work through it. You refine each copy's real
location later, during sorting.

### Sorting copies

Sorting is where **To sort** copies become **Delivered** (in your collection). Work at
whatever granularity suits the parcel — everything works the same way: **tick what you mean, then
use the bar that appears at the top of the order** (see
[Two acts](#two-acts-store-and-move)). There are three checkboxes and they behave alike —

- **A whole lot** — the checkbox in its header, which works on a **collapsed** card too.
- **A whole issue** — the checkbox on the issue header, in any **By issue** view.
- **A batch you pick yourself** — the checkbox on each copy's row.

A container's box shows a **dash** when only part of it is ticked, and unticking something
underneath one simply leaves it out. Ticking a lot or an issue means every copy in it, including
the ones further down the list that have not loaded yet — and when a filter chip is on, it means
every copy **that chip is showing** (pressing the chip afterwards releases that tick, since it no
longer describes what you are looking at).

There is **one selection for the whole order and one bar**, above the lots. A batch on your desk
does not respect lot boundaries — copies from three lots go onto one transport card in one act —
so the selection spans lots, and the bar is pressed once rather than once per card. Changing
**Group by** or the sort order is a change of view and leaves what you picked standing.

You can also edit **a single copy** right on its row: its **delivery chip** is a dropdown for
setting the status (Ordered, In transit, To sort, Delivered, …) with a **→** button beside it
to advance one step, and its **disposition** shows all three flags — **In collection / For
sale / For trade** — as chips you click to toggle instantly (no expand or confirm step). Its
**location chip** (or the **📍 Set location** button when it has none) opens the location
tree-select. For condition or certificate changes use its **⋮** menu → **Edit copy** — e.g.
if the seller shipped a different condition than expected (MH instead of MNH), correct it
there.

To focus on what's left, click the lot header's **N to sort** chip to filter the list down to
just the copies waiting to be sorted; click it again (or the **To sort only ✕** button) to show
all. As you sort each copy it drops out of the filtered list. The chip counts copies in the
**to sort** state only — copies still *ordered* or *in transit* haven't arrived yet, so there
is nothing to sort about them (the close confirmation still counts those; see
[Closing a lot](#closing-a-lot)).

The lot header also carries a **N no photos** chip whenever some of the lot's copies have no
[photo](inventory.md#photos) attached — click it to filter the list down to just those copies
so you can see what still needs photographing, and click it again (or **No photos only ✕**) to
show all. Unlike the *to sort* and *unpriced* chips, this one stays available after the lot is
closed, since photographing usually happens once the stamps are in hand.

When you put copies into a **location** (storing, moving, or setting one copy's), the picker
remembers the last location you used and pre-selects it, so working box after box is one click.
New copies can still be identified into a lot at any time while it is open — handy for a mixed
album bought sight-unseen.

If a copy turns out to be a **different variant** than expected, its **⋮** menu →
**Identify variant** re-points it to the right one (available when the copy is linked to a
base stamp with variants).

### Two acts: Store and Move

Once something is ticked, a bar appears above the list with the two things you can do to it.
They are two, and deliberately not one dialog with a *mark them sorted* checkbox: relocating a
card and declaring a batch worked through are different claims, and a checkbox nobody notices
would quietly make the second one for you.

**Store** puts copies away — where they now live, the ref card they sit on, what they are being
kept for, and **delivered**, in one act. It asks for:

- a **location** — *Leave as is* or one you pick, pre-filled with the last one you used;
- a **ref** — optional, and only once a location is chosen (a ref numbers a card *inside* a
  location, so there is nowhere to put one otherwise);
- a **disposition** — *Leave as is* (the default), or **In collection / For sale / For trade**.

Leaving the location alone is the ordinary path for a batch you already filed **copy by copy**
during the pass: it declares them sorted without overwriting where each of them was put. The
disposition's *Leave as is* works the same way, and is different from turning all three chips
off, which *clears* the dispositions. Copies already sorted, damaged, or not delivered keep
their delivery status — anything else you set still applies to them.

**Move to location** changes where copies live and claims nothing else: no disposition, no
delivery status. That is the act of filing a parcel into an incoming box on arrival, or
shifting a card between boxes months later. Its location is **required** — the change of
address *is* the act.

Ticked copies survive the filter chips and scrolling, so you can narrow to **N to sort**, tick
your way down the list, and clear the chip without losing what you picked. The bar also offers
**Select the whole order** — every copy of it still in an open lot, which is how you reach
everything from the flat copy list, where there is no heading to tick. Press **Clear** to start
again.

Copies in a **closed** lot get no checkbox anywhere: they are read-only until you reopen it.

#### The ref

The ref is the identifier written on the **ref card** that goes with the stamps: one small
card usually covers a whole transport card's worth, with a per-series card whenever a set
should come out in one grab. It is suggested as **the next free ref in that location** — never
per lot, because the box is shared across every purchase — so storing continues the strip the
box is already on. A location nothing has ever been ref'd in suggests nothing and stays blank,
which is the normal case for an album or stockbook: there the location *is* the address.

Typing a ref that is **already in use** is not an error. Cards get topped up over several
sittings, so the dialog says *"A147 already holds 12 copies"* and the button reads **Add to
A147** — which also catches the typo, since an unexpected collision reads differently from an
expected one.

Blank cards are printed **before** you pack — see
[Printing blank ref cards](locations.md#printing-blank-ref-cards).

### Closing a lot

When a lot is fully sorted, **Close lot** runs the cost allocation: the lot's pool is
distributed across its copies in proportion to each copy's **primary-catalog price** for its
condition (and certificate), and each copy's share is **frozen** as its cost-basis. Closing
works even if the shipment has not physically arrived yet.

If any copies are still unsorted (ordered / to sort / in transit), the confirm dialog **warns
you** — but you can still close (sorting first is just recommended, not required). This warning
is deliberately wider than the header's **N to sort** chip: a lot whose copies are all still
*ordered* has not been through the sort pass either.

Closing is **blocked** if any copy lacks a primary-catalog price for its condition — there is
no weight to split the pool by. The screen highlights the copies that need a price and shows
how many are unpriced; click the **⚠ N unpriced** chip to filter the list down to just those
copies. To price them without leaving the screen, click the **+ catalog value** link in the
copy's catalog-value column — a small dialog sets those values (latest edition) for the copy's
condition × certificate. It shows **one field per catalog vendor active on the stamp's area**,
with the **primary catalog's** field focused first for fast entry; the other vendors' fields are
optional, so you can price several catalogs in one pass or leave any blank to skip it. Saving
requires at least one value. The dialog also shows the stamp's issue, catalog numbers (the
primary catalog's number highlighted), the condition it applies to (shown as a badge), area, and
this **copy's photos** (click a thumbnail to open the lightbox, with prev/next and Esc to close),
plus any prices already recorded for it (across editions, conditions, and certificates) so you
can price consistently — the target rows are marked with an arrow. Closing still only requires a
**primary-catalog** price. (For fuller edits, a copy's **⋮** menu → **Edit stamp** opens the
**Prices** tab.) Then try the close again.

### Reopening for corrections

**Reopen lot** flips a closed lot back to open and returns every copy's cost-basis to
pending, so you can add, remove, or re-price copies. Close it again to re-run the allocation
with the corrected membership.

Cost-basis is **frozen at close** and is not recomputed automatically afterwards. If you later
correct a copy's variant or condition, or edit a catalog price, a closed lot's snapshots stay
as they were — reopen and re-close the lot if you want them recalculated.
