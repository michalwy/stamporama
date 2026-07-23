# Purchases

A **purchase** records one acquisition — a single event where money changed hands. It is
where your **cost** lives: what you paid a dealer, an auction house, or a private seller,
including shipping. A purchase groups together everything bought in that transaction.

Open the **Purchases** screen from the **Trading** section of the sidebar.

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

The order's line items are managed separately, during **lot intake**:

- **Lots** — the *inventory* lines. A lot is a priced parcel — a single stamp, a whole
  series, an album, or a whole box you sort over time. You either leave a lot empty until
  you have sorted it or fill it with individual copies straight away.
- **Expenses** — the *non-inventory* lines. Something bought alongside the stamps that is
  not itself stock — a magnifier, a catalogue, a stockbook: a label and a price. An expense
  absorbs its fair share of the shipping cost so it does not inflate the value of the stamps.

So a freshly recorded purchase has no lines at all — you add them during intake, and its
list total grows as you do.

All amounts on a purchase — the shipping cost and, once added, the lots and expenses — are
in the one transaction currency you pick. If that currency differs from your collection's
base currency, the exchange rate as of the purchase date is captured and stored with the
record.

## The purchases list

Each row shows the **supplier** (or *No supplier*, with *via …* when a platform is set), the **date**, the delivery **status**, a
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

### Identifying stamps (intake)

A large lot is rarely sorted in one sitting — you identify stamps into it as you work through
the parcel, often long after the money changed hands. Click the lot's **＋ Add stamps** button
(in its header, while the lot is open). This opens the same **browse popup** used across the
app: navigate areas and issues, and either

- pick a **single stamp** (creating the issue/stamp first if needed), or
- add a **whole issue** with the **+ Whole issue** button on the issue row — this creates a
  copy for every stamp in that issue marked *required for completeness*.

You are then asked once for the **condition**, an optional **certificate**, an optional
**storage location** — with an optional **in-location ref** (e.g. a page or pocket like
`A234`) once a location is chosen — and an optional **disposition**. Disposition shows the
three flags (**In collection / For sale / For trade**) as chips you click to toggle on the
spot; they preset where each created copy is headed and can be combined. All of these apply to
every copy created in that step. Your last choices — disposition included — are remembered and
pre-filled for the next stamp, so sorting a parcel into the same box, condition, and
disposition is quick. When you are adding a **single stamp** you can also **attach
photos** to that copy right here (front/back plus extra images); a whole-issue intake creates
several distinct copies, so photos are offered only for single-stamp intake. The copies are
linked to the lot and marked **Ordered** — purchased but
not yet in hand, so they are deliberately **not** counted as *in collection* yet. (They
become part of your collection later, once received.)

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
thousands of positions shows every copy, and **Mark all copies sorted** / **Move all copies to
a location** act on the entire lot (or issue group), not just the rows you have loaded.

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
required/total stamp count) and can be collapsed or expanded. **Lot management** (add stamps,
edit price, close/reopen, delete, whole-lot move/mark-sorted) lives only in a **by-lot** view —
the issue-only and flat views are for sweeping through copies and sorting them.

Each copy's **⋮** menu also offers **Edit copy** (condition, certificate, storage,
disposition) and **Edit stamp** (the underlying stamp, including its catalog prices on the
**Prices** tab) — so you can correct a copy or fill in a missing price without leaving the
lot.

To remove a stamp from a lot, use its **⋮** menu → **Remove from lot**. Because these copies
exist only to populate the lot, removing one **deletes** it.

### The delivery lifecycle: ordered → to sort → delivered

Each copy carries a **delivery status** shown as a chip on its row, separate from its
disposition (in collection / for sale / for trade). A purchased copy moves through:

- **Ordered** — added during intake; bought but not yet in hand, so it is **not** in your
  collection yet.
- **To sort** — the order arrived but this copy still needs sorting; still **not** in the
  collection.
- **Delivered** — sorted and filed; now counted **in your collection**.

with **Not delivered** and **Damaged** as outcomes you may discover while sorting.

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
whatever granularity suits the parcel:

- **A whole lot** — its **⋮** menu → **Move all copies to location…** or **Mark all copies
  sorted**.
- **A whole issue** — in the **By issue** view, each issue header has a **📍** (move to
  location) and a **✓** (mark sorted) button acting on that issue's copies.
- **A single copy** — edit it right on the row: its **delivery chip** is a dropdown for
  setting the status (Ordered, In transit, To sort, Delivered, …) with a **→** button beside it
  to advance one step, and its **disposition** shows all three flags — **In collection / For
  sale / For trade** — as chips you click to toggle instantly (no expand or confirm step). Its
  **location chip** (or the **📍 Set location** button when it has none) opens the location
  tree-select. For condition or certificate changes use its **⋮** menu → **Edit copy** — e.g.
  if the seller shipped a different condition than expected (MH instead of MNH), correct it
  there.

To focus on what's left, click the lot header's **N to sort** chip to filter the list down to
just the unsorted copies; click it again (or the **To sort only ✕** button) to show all. As
you sort each copy it drops out of the filtered list.

The lot header also carries a **N no photos** chip whenever some of the lot's copies have no
[photo](inventory.md#photos) attached — click it to filter the list down to just those copies
so you can see what still needs photographing, and click it again (or **No photos only ✕**) to
show all. Unlike the *to sort* and *unpriced* chips, this one stays available after the lot is
closed, since photographing usually happens once the stamps are in hand.

**Mark sorted** (whole lot or whole issue) moves *not-yet-sorted* copies (ordered / to sort /
in transit) to **Delivered** and asks which **disposition** to file them under — In collection
(the default), For sale, and/or For trade — so a batch headed for sale doesn't have to be
un-filed afterwards. The same dialog also lets you file the copies into a **location** in one
step (pre-filled with the last one you used; leave it *as-is* to skip). Copies already sorted,
damaged, or not delivered keep their delivery status, but a chosen location still applies.

When you file copies into a **location** (moving a lot/issue, or a single copy), the picker
remembers the last location you used and pre-selects it, so filing copy after copy into the
same box is one click. New copies can still be identified into a lot at any time while it is
open — handy for a mixed album bought sight-unseen.

If a copy turns out to be a **different variant** than expected, its **⋮** menu →
**Identify variant** re-points it to the right one (available when the copy is linked to a
base stamp with variants).

### Closing a lot

When a lot is fully sorted, **Close lot** runs the cost allocation: the lot's pool is
distributed across its copies in proportion to each copy's **primary-catalog price** for its
condition (and certificate), and each copy's share is **frozen** as its cost-basis. Closing
works even if the shipment has not physically arrived yet.

If any copies are still unsorted (ordered / to sort / in transit), the confirm dialog **warns
you** and the lot header shows a **N to sort** chip — but you can still close (sorting first is
just recommended, not required).

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
