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
Every amount field accepts either a comma or a period as the decimal separator — type `12,50` or
`12.50`, whichever your keyboard gives you.

- **Buyer handling** and **Commission** — the amounts you know at sale time: the postage/handling
  the buyer paid you (**adds** to proceeds) and the platform's fee (**subtracts**). Your own
  shipping cost is added later on the detail screen.
  - **Buyer handling has two entry modes.** By default you enter the **total the buyer paid** and
    the handling is worked out as **total − the offer prices**; the total is remembered, so as you
    add sold sets the handling **shrinks by itself** and the total stays put. Use **Enter handling**
    to type the handling directly instead (then the handling is fixed and the total is whatever the
    offers plus handling come to). At creation no sets are picked yet, so the total equals the
    handling until you add them. A total below the offer prices — which would make handling
    negative — is flagged and can't be saved.

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
asking price pre-fills, since the offer and the sale share the platform's currency). The price is
just a starting point — **override it** whenever the set actually sold for a different amount (say
you gave the buyer a discount). The override belongs to **this sale only**; the offer's own asking
price is never changed. **Add** records them all at once. You can come back and add more sets later,
or **Remove** one from its row menu.

Already added a unit at the wrong price? On the **Sold units** list, click a unit's price to **edit
it in place** (Enter or click away saves, Escape reverts) — again, only the sale record changes, and
the gross, net, and any total-based buyer handling recompute automatically.

A sale is **single-currency**, so only offers in the sale's currency can be added. If you changed
the platform's currency after listing, any offer still on the **old** currency is shown flagged
**⚠ CUR — re-list** and can't be selected — re-list it in the platform's current currency first.

### Step 3 — amounts

The **Amounts** section shows the proceeds breakdown: the gross of the line prices, the shared
amounts, and the resulting net. Each shared amount — **my shipping** (−) and **commission** (−),
plus **buyer handling** (+) when you entered it directly — is **editable in place**: rows with a
pencil (✎) can be clicked to edit. Click the value (or **Set** when empty), type the amount, and
press Enter (Escape reverts).

When the sale's currency differs from your base currency, each amount also shows a base-currency
equivalent (**≈ 200 PLN**) beside it — gross, buyer handling/total, commission, and each sold unit's
price — converted at the sale's **frozen** rate. The net proceeds are already shown in the base
currency, and the sale list shows each sale's net in base too.

**My shipping can be in any currency.** Postage is often paid in your own currency, not the
marketplace's, so the shipping row has its own currency selector (defaulting to the sale currency).
Whatever currency you pick, the cost is converted **straight to your base currency** at the rate on
the sale date, and it's the base amount that feeds profit. The row shows the base equivalent beside
a foreign-currency amount (or flags **no rate** if none is known yet). Because shipping lands in the
base currency, the **net proceeds** figure — on the sale, its rows, and the list — is shown in the
**base currency**. For a single-currency collection (base = sale currency) nothing looks different.

If the sale is anchored on the **total paid** (the default), the breakdown instead shows an
editable **Total paid by buyer** row and a read-only **buyer handling** derived below it — the
handling follows the total minus the offer prices and re-settles automatically as you add or
remove sold sets. If the total ever falls below the offer prices, handling is held at 0 and a
warning asks you to raise the total. Switch a sale between the two modes any time from **Edit
header**.

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

## Fulfillment status

A sale carries a **fulfillment status** that tracks its progress through a fixed sequence:

**Ordered → Paid → Packed → Sent → Received**

A new sale starts at **Ordered**. On the detail screen's header, the **Status** control lets you
either pick any step from the dropdown or click the **→ next** button to advance one step. Each
change is saved immediately and stamped with the moment it happened, so the sale keeps a timeline
of its transitions. The current status also shows as a chip on each sale's list row.

Status is independent of everything else on the sale — advancing it never changes copies or offers,
and it can move backward (pick an earlier step) if you need to correct a mistake.

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

Each copy row has a **packed** checkbox on its left. Tick it as you physically pack that piece —
packing happens copy by copy, so this is tracked **per copy**, independent of the sale's overall
[status](#fulfillment-status). When every copy on the sale is packed, the header shows a gentle
**"All copies packed — advance to Packed?"** hint next to the status control; it's only a reminder —
you still advance the status yourself, it never changes on its own.

Remove a sold set from its card's **⋮** menu (its copies become available again).

## Deleting

From a list row's **⋮** menu you can **delete** a sale — that removes the record, makes its copies
available again, and returns any offers it marked sold to **Active**.

## Finding a sale

The Sales toolbar has a **search** box and a **platform** filter. Search matches the buyer name,
the platform name, the order number, and the **name or catalog number of any copy** sold on the
sale — so you can find a sale by what was in it, not just who bought it. The platform dropdown
narrows the list to a single marketplace; the two combine.

## Related

- [Offers](offers.md) — the listings (and their sets) a sale is recorded against.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used for profit/loss.
