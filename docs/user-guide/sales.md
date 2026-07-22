# Sales

A **sale** records that one or more of your [offers](offers.md) sold. A sale happens on a single
platform, in a single currency, on one date — the date the exchange rate is frozen at, so
profit/loss is measured against a fixed rate.

Open the **Sales** screen from the **Trading** section of the sidebar.

## Recording a sale

Recording a sale works like [purchases](purchases.md): you create a short **header** first, then
add what sold on the sale's own detail screen.

### Step 1 — the header

Click **Record sale** and fill in:

- **Platform** — the marketplace the sale happened on. Start typing to search your platform
  [contacts](contacts.md). A sale is single-platform.
- **Buyer** — who bought (optional). Search or add a buyer contact; leave it blank if the buyer
  is unknown or anonymous.
- **Order number** — the transaction/order number from the marketplace (optional), so you can
  reconcile the sale against the external system later. Shown on the sale row and header.
- **Sale date** — defaults to today; the FX rate to your base currency is frozen at this date.
- **Currency** — the transaction currency for every amount on the sale.
- **Buyer handling** and **Commission** — the two amounts you already know at sale time: the
  postage/handling the buyer paid you (**adds** to proceeds) and the platform's fee
  (**subtracts**). Your own shipping cost is added later on the detail screen.

**Continue** creates the sale and opens its detail screen.

### Step 2 — add the sold units

On the detail screen, **Add sold units** opens a browse-and-pick dialog listing every unit still
sellable on the sale's platform. Filter by **kind** (unit / quantity) in the left panel, or
**search** by lot title, sub-lot, or catalog number. Each unit is a whole sellable piece:

- A **unit lot** (a single stamp or an indivisible *komplet*) is one row — ticking it sells the
  whole thing.
- A **quantity lot** is a single **collapsible row**; expand it to reveal its member **sub-lots**
  and tick the specific ones the buyer took. A sub-lot is a whole unit — a series never breaks
  apart, so selecting it retires all of its copies together.

Tick every unit that sold and set each one's **sale price** in the sale currency (the offer's
asking price pre-fills when the currencies match). **Add** records them all at once. You can come
back and add more units later, or **Remove** one from its row menu.

### Step 3 — amounts

The **Amounts** section shows the proceeds breakdown: the gross of the line prices, the three
shared amounts, and the resulting net. Each shared amount — **buyer handling** (+), **my
shipping** (−), and **commission** (−) — is **editable in place**: rows with a pencil (✎) can be
clicked to edit. Click the value (or **Set** when empty), type the amount, and press Enter
(Escape reverts). Handling and commission can also be set upfront in the header dialog.

You can revise the header (platform, buyer, date, currency, buyer handling, commission) any time
with **Edit header** — though the platform is locked once units are recorded, since a sale stays
on one platform.

## What a sale changes

- The exact **copies** that left are recorded on the sale and become **unavailable** — they drop
  out of your for-sale inventory and can never be sold twice.
- Each **offer** the sale went through flips to **Sold**.
- The **lot's** sold / partially-sold status follows automatically from the sub-lots that left.

The shared amounts are split across the sold units in proportion to their sale prices, and each
unit's net is converted to your base currency at the frozen rate — this feeds per-item
profit/loss (surfaced with the profit/loss views).

## Packing view

The detail screen doubles as a **packing list**. Each sold unit is a collapsible card (expanded
by default) whose header shows the unit, its copy count, price, and net. Expanding it shows the
exact physical copies that left — as full inventory rows with catalog number, condition, and
**location**, so you can pull each piece to pack it. It works like a purchase order:

- The primary grouping is **Lot** (each sold unit its own card, the default), **Location** (a
  section per storage spot — a packing walk-order, so you clear one spot at a time), or neither
  (a flat stream). Lot and Location are mutually exclusive.
- **Issue** sub-groups the copies within whichever primary you chose.
- **Sort copies** orders the copies; the card and issue headers **stick** to the top as you
  scroll a long order.
- Copies load lazily, so even a large sale opens quickly. Use **Collapse all** / **Expand all**
  to switch between an overview and full contents.

Remove a sold unit from its card's **⋮** menu (its copies become available again).

## Deleting

From a list row's **⋮** menu you can **delete** a sale — that removes the record, makes its copies
available again, and returns any offers it marked sold to **Active**. Filter the list by
**platform** from the toolbar.

## Related

- [Offers](offers.md) — the listings a sale is recorded against.
- [Lots](lots.md) — the packages, whose sold status derives from sales.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used for profit/loss.
