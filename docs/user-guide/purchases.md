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
