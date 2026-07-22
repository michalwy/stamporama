# Lots

A **lot** is a package you compose from your inventory to sell. It is **platform-agnostic** —
*what* you are selling, independent of *where* you list it. Listing a lot on a marketplace
(Delcampe, Allegro, Colnect…) and recording the eventual sale come later; a lot on its own is
just the package.

Open the **Lots** screen from the **Trading** section of the sidebar.

## Two kinds of lot

You choose a lot's **kind** when you create it, and it cannot change afterwards — the kind
decides what the lot holds:

- A **unit lot** is the atomic thing you sell: a **single stamp**, or an indivisible
  **komplet** — several *different* stamps sold together as one set. A unit lot holds
  **copies** from your inventory directly. A komplet never breaks apart.
- A **quantity lot** groups **interchangeable sub-lots** — several unit lots of the same
  shape, sold by whole units. A buyer taking three units takes three entire sub-lots, so a
  series inside a sub-lot never splits. A quantity lot holds **sub-lots**, not copies.

A copy can be packaged into more than one lot at a time (for example, on its own in one lot
and as part of a komplet in another) — packaging a copy does not remove it from your
inventory or from other lots.

## Composing a lot

1. Click **New lot**, pick the kind, and optionally give it a title. Leaving the title blank
   is fine — the screen derives a label from the packaged copies.
2. You land on the lot's **detail screen**. For a unit lot, click **Add copies** to open the
   **inventory picker** — laid out like the Copies list, with the area sidebar and year facets
   on the left and a **flat, searchable list** of copies on the right. Only copies flagged
   **For sale** and physically **delivered** (in hand — a copy still in transit can't be
   packaged), that are unsold and not already in this lot, appear. Tick the copies you want — or the
   **All** checkbox to take everything currently shown — and **Add**. The picker remembers its
   area, year, and search text, so it reopens on the same filter you left it on.

   A **quantity lot** is built from two sources, via two buttons on its detail screen:
   - **Add copies** — the same inventory picker; each copy you tick becomes its own
     single-stamp sub-lot automatically (the fast path for a stock of duplicates). All copies
     in one quantity lot must be the **same stamp and condition** — the picker restricts to the
     lot's stamp and condition once it has one.
   - **Add lots** — pick from your existing **unit lots** (e.g. interchangeable komplets). Only
     lots whose **shape** (their set of stamps × conditions) matches the lot's are offered.

   Every sub-lot in a quantity lot must be **interchangeable** — the same **stamp and
   condition** (the first one you add fixes the shape). A difference in **certificate status** is
   allowed but shows a **warning** in the picker, since the lot then isn't uniform on
   certificate. Each sub-lot row expands to show its copies.

   A unit lot that's grouped into a quantity lot **still appears** on the main Lots list, marked
   **In quantity lot** — you can list it standalone too (e.g. on one marketplace), and whichever
   sells first takes the copy. Use the **Hide grouped** toggle in the toolbar to drop grouped
   unit lots for a cleaner view.
3. Composed copies show on the lot exactly as they do in the inventory list. Use the
   **Group by Issue** toggle and the **Sort copies** control (order added, year, catalog number,
   price, or name — with an ascending/descending switch) to arrange them, just like on a
   purchase order; the choice is remembered. As on a purchase order, an unpriced copy shows a
   **+ catalog value** link (and a priced one is click-to-edit) that sets the copy's catalog
   value inline on its stamp's primary catalog, without leaving the lot. Remove a copy through
   its **⋮** menu →
   **Remove from lot** (or the **✕** on a sub-lot). Removing never deletes the copy — it just
   unpacks it.

The header shows the lot's **catalog value** — the summed value of the copies it packages —
so you have a reference while composing.

## Lifecycle: draft → ready → dissolved

Every lot has an explicit **state**:

- **Draft** — you are still composing it. This is where a lot starts.
- **Ready** — composition is settled and the lot is ready to list. Use **Mark ready** once
  the lot has at least one member. **Return to draft** flips it back.
- **Dissolved** — the lot did not sell, so you **unpack** it. **Dissolve** returns its
  members to your inventory (they become available to repackage) and keeps the lot on record
  as dissolved. Dissolving cannot be undone; a dissolved lot is read-only and can be deleted
  from the lots list.

A lot's **sale status** — *Available*, *Partially sold*, or *Sold* — is **derived** from
whether its members have sold, never set by hand. Until a member sells it stays *Available*.
A lot that has sold cannot be dissolved or deleted, so the sale record is preserved.

## Filtering

The toolbar filters the list by **kind** (Unit / Quantity) and by **state** (Draft / Ready /
Dissolved). Deleting a lot removes the package and any listings, but never touches the copies
it held — those stay in your [inventory](inventory.md).

## Listing a lot on marketplaces

Once a lot is composed, list it on one or more platforms from its **Offers** section (or the
**Offers** screen). See [Offers](offers.md) for pricing, the one-active-offer-per-platform
warning, and the offer lifecycle.

## Related

- [Inventory](inventory.md) — the copies you compose lots from.
- [Offers](offers.md) — listing a lot on marketplaces.
- [Sales](sales.md) — recording the sale when a lot's offer sells.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used later for
  profit/loss on a sale.
- [Contacts](contacts.md) — the platforms you will list lots on.
