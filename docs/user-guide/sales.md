# Sales

A **sale** records that one or more of your [offers](offers.md) sold. A sale happens on a single
platform, in a single currency, on one date — the date the exchange rate is frozen at, so
profit/loss is measured against a fixed rate. The **currency comes from the platform**, the same
one its offers use, so an offer and its sale always agree.

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
- **Currency** — fixed by the platform and shown locked; every amount on the sale is in it. The
  first time you sell (or list) on a platform that has no currency yet, you pick one inline and it
  is saved to the platform.
- **Buyer handling** and **Commission** — the two amounts you already know at sale time: the
  postage/handling the buyer paid you (**adds** to proceeds) and the platform's fee
  (**subtracts**). Your own shipping cost is added later on the detail screen.

**Continue** creates the sale and opens its detail screen.

### Step 2 — add the sold sets

On the detail screen, **Add sold sets** opens a browse-and-pick dialog listing every
[set](offers.md) still sellable on the sale's platform, grouped by offer. **Search** by offer,
set, or catalog number. Each set is a whole sellable piece:

- A single-set offer is **one row** — ticking it sells the whole thing.
- A multi-set (quantity) offer is a **collapsible row**; expand it to tick the specific sets the
  buyer took. A set is indivisible — a series never breaks apart, so selecting it retires all of
  its copies together.

Tick every set that sold and set each one's **sale price** in the sale currency (the offer's
asking price pre-fills, since the offer and the sale share the platform's currency). **Add** records
them all at once. You can come back and add more sets later, or **Remove** one from its row menu.

A sale is **single-currency**, so only offers in the sale's currency can be added. If you changed
the platform's currency after listing, any offer still on the **old** currency is shown flagged
**⚠ CUR — re-list** and can't be selected — re-list it in the platform's current currency first.

### Step 3 — amounts

The **Amounts** section shows the proceeds breakdown: the gross of the line prices, the three
shared amounts, and the resulting net. Each shared amount — **buyer handling** (+), **my
shipping** (−), and **commission** (−) — is **editable in place**: rows with a pencil (✎) can be
clicked to edit. Click the value (or **Set** when empty), type the amount, and press Enter
(Escape reverts). Handling and commission can also be set upfront in the header dialog.

You can revise the header (platform, buyer, date, buyer handling, commission) any time with
**Edit header** — though the platform is locked once units are recorded, since a sale stays on one
platform. The currency stays fixed as a permanent record: editing a sale never rewrites it, and
changing the platform's currency later leaves existing sales untouched.

## What a sale changes

- The exact **copies** that left are recorded on the sale and become **unavailable** — they drop
  out of your for-sale inventory and can never be sold twice.
- Each **offer** flips to **Sold** once *every* one of its sets has sold through it; a partial sale
  keeps it **Active** for its remaining sets.
- Any **other active offer** — on another platform — holding a set with a copy you just sold is
  flagged **Needs action**, so you can take those stale listings down. See
  [keeping platforms in sync](offers.md) on the Offers page.

The shared amounts are split across the sold units in proportion to their sale prices, and each
unit's net is converted to your base currency at the frozen rate — this feeds per-item
profit/loss (surfaced with the profit/loss views).

## Packing view

The detail screen doubles as a **packing list**. Each sold set is a collapsible card (expanded
by default) whose header shows the set, its copy count, price, and net. Expanding it shows the
exact physical copies that left — as full inventory rows with catalog number, condition, and
**location**, so you can pull each piece to pack it. It works like a purchase order:

- The primary grouping is **Set** (each sold set its own card, the default), **Location** (a
  section per storage spot — a packing walk-order, so you clear one spot at a time), or neither
  (a flat stream). Lot and Location are mutually exclusive.
- **Issue** sub-groups the copies within whichever primary you chose.
- **Sort copies** orders the copies; the card and issue headers **stick** to the top as you
  scroll a long order.
- Copies load lazily, so even a large sale opens quickly. Use **Collapse all** / **Expand all**
  to switch between an overview and full contents.

Remove a sold set from its card's **⋮** menu (its copies become available again).

## Deleting

From a list row's **⋮** menu you can **delete** a sale — that removes the record, makes its copies
available again, and returns any offers it marked sold to **Active**. Filter the list by
**platform** from the toolbar.

## Related

- [Offers](offers.md) — the listings (and their sets) a sale is recorded against.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used for profit/loss.
