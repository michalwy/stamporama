# ADR-0068: Packing Supplies — Bought on Purchase Orders, Held in Stock, Costed FIFO

## Status

Accepted. Decided with the collector on 2026-10-13 and built by #1897, the foundation of a track:
#1898 takes supplies onto a sale's shipping cost, #1899 gives a shipping method its default supplies,
#1900 takes supplies out of stock without a sale. Amends [ADR-0009](0009-purchase-record-model.md) §1
and §3 with a third kind of purchase line.

## Context

What a parcel costs the collector is more than postage: envelopes and transport cards go into every
parcel. Until now the collector added these up by hand for every sale and typed one amount as the
sale's shipping cost. The app knew nothing of the supplies themselves, what they cost or how many were
on hand.

The supplies are bought like anything else — a box of 100 C6 envelopes from a stationer, or on the same
order as stamps — so the purchase model already holds most of what is needed: a dated order in one
currency, with shipping spread over its lines by price.

## Decision

### 1. A supply is a name, and its price is never typed

`PackingSupply` is a dictionary entry per collection — *C6 envelope*, *bubble envelope 15×21*,
*transport card A6* — managed under **Settings → Packing supplies**, with nothing else to set. Its
name is unique within the collection, as a carrier's is.

**Supply prices come from purchases** (the collector's call): what an envelope costs follows from the
purchase it was bought on. A typed unit price was rejected — it would be a second figure beside the
money actually paid, and it would go stale the next time a box cost more.

### 2. A supply is bought as a line of an ordinary purchase order

`PurchaseSupplyLine` is a **third kind of purchase line** beside ADR-0009's inventory `PurchaseLot`
and non-inventory `PurchaseExpense`: it names the supply, a whole quantity (> 0) and the line price
(≥ 0, `Decimal(10,2)`). A supply line sits on an order alone or beside stamps, with its supplier and
date like any purchase.

It is a **table of its own** for ADR-0009 §1's reason: a lot holds copies and has a lifecycle, an
expense is not stock, and a supply line is stock with a quantity — a discriminator over one table
would leave half of every row meaningless.

### 3. Each supply line is a batch, and its unit cost includes its share of the shipping

ADR-0009 §3.1 spreads the order's shipping across **all** its lines by price; supply lines join that
split (`distributeSharedCost` reads lots, expenses and supplies). A box of envelopes therefore absorbs
its fair share and does not make the stamps dearer, and a batch's cost is

> (line price + its share of the order's shipping) ÷ quantity per unit.

`StoredPurchaseCosts.supplyLines` is **required**, not optional: a reader that left supply lines out
would split the shipping differently from every other reader, and the compiler is what keeps them in
step.

The unit cost is **derived, not stored**. It moves while the order's shipping or its other lines are
still being restated, exactly as an open lot's estimate does. What freezes a figure is using the
supplies — that is #1898's to record, at the cost of the batch it took from. *(Amended by §7: a use
records the batch, and its cost stays derived from it.)*

### 4. Stock is costed FIFO

Supplies leave stock **oldest batch first**, each unit at the unit cost of its own batch (the
collector's call). "Oldest" is the purchase date, then the order the lines were written in. The rule
is pure in `src/lib/supply-stock.ts` (`fifoSupplyStock`) so the screen that shows what is on hand and
the sale that takes from it cannot disagree about which batch went first. Weighted average was not
chosen.

The **Supplies** screen (`/c/[slug]/supplies`, under Selling) shows per supply the quantity on hand,
its value at FIFO cost in the base currency, and its batches with the intake document each came from.
A batch bought in a foreign currency with no frozen rate has no base-currency cost; a supply holding
one states **no value** rather than a partial sum (#1184), and says how many batches are why.

### 5. An opening balance brings supplies in, at a required value

Supplies on hand before tracking starts are entered through an opening balance (ADR-0054), as stamps
are. The line's price is then the batch's **opening value**, and it is **required** there too — the
collector's call on 2026-10-14, departing from an opening-balance lot, whose value is optional: a
batch without a cost would leave every parcel packed from it without one. An opening balance carries
no shipping, so its unit cost is simply value ÷ quantity.

An opening balance's **opening value** (ADR-0054 §7, the lead line of its panel and its total on the
Intake documents list) stays the value of its **lots** — what the copies bring in. Its supply lines
are shown, with their value, on the order's *Packing supplies* card and on the Supplies screen. A
purchase's total and spend do count its supply lines: they were paid for.

### 6. A supply that was bought cannot be deleted

The line's reference to its supply is `NO ACTION`: the app refuses the delete and says why, and a whole
collection — cascading to its supplies and its purchases in one statement — still deletes. Deleting a
purchase takes its supply lines, and with them their batches, as it takes its lots and expenses.

### 7. A sale uses supplies: postage plus supplies is *my shipping* (#1898)

Added 2026-10-14 by #1898. The collector decided on 2026-10-13 that **a sale's shipping cost is the
postage plus the supplies used**, summed by the app instead of typed, and that **the supplies are
taken from stock FIFO** at their batches' unit costs.

- **The postage is `Sale.shippingCost`**, typed or prefilled from the shipping method as before
  (#468). A sale recorded before #1898 has no supply lines, so its typed amount stays the whole of
  its shipping and nothing is migrated.
- **`SaleSupplyLine`** names a supply and how many units the parcel used. **`SaleSupplyUse`** records
  how many of them came from which batch. *My shipping* = postage in the base currency + the sum of
  the uses at their batches' unit costs; every reader of a sale's net computes it the same way.
- **Which batch a unit came from is recorded, not replayed.** Replaying FIFO over every sale in date
  order would need no table, but returning one sale's envelope would then re-assign later sales to
  other batches and move their figures; the issue decided that a returned supply goes back **at the
  cost it was taken at**. So a write takes FIFO at that moment and the record stands.
- **A use's cost is derived from its batch, not frozen** — departing from §3's last sentence. A frozen
  unit cost would stop agreeing with its batch the moment the order's shipping, its other lines or its
  rate were restated, and the stock's value plus what sales used would no longer add up to what was
  paid. Recording the batch is what "at the cost of the batch it took from" needs; the figure
  settles when the purchase does, as a lot's estimate does.
- **Using more than is on hand is allowed** (the issue's decision): the line holds what stock had and
  the rest is **short**, uncosted, the total marked incomplete as #1875 marks a profit with a missing
  cost. A unit from a batch with no rate into the base currency is uncosted the same way.
- **One rule keeps uses and stock in step** (`settleSupplyUses`, pure; `settleSupplies` runs it in the
  transaction of every write that changes a supply's stock or demand). It never moves a unit that
  still fits; it gives back what a lowered line or a lowered batch no longer covers — a line's
  newest-batch units first, a batch's latest-sale units first — and then covers short lines,
  earliest sale first, from the oldest batch with units left. Afterwards a supply never has both a
  short line and units on hand, so a purchase covers a shortfall by itself and a new line is FIFO.
- Changing or removing a sale's line, or deleting the sale, returns its units to their batches;
  deleting or lowering a batch hands its units back to the sales that held them, which take them
  from the supply's other batches where they can. A supply a sale used cannot be deleted.

### 8. A shipping method carries its usual supplies (#1899)

Most parcels of one kind take the same supplies — a registered letter goes in a C6 envelope with two
transport cards — so a platform's shipping method can list them, with quantities
(`ShippingMethodSupply`: method, supply, a whole quantity > 0, each supply once per method).

- **The list is a default, read only when a sale's method is chosen or changed.** Recording a sale
  with the method, or picking it on the sale's shipping row or in its header, fills the list in as the
  sale's supply lines, which take their units from stock FIFO (§7) and stay editable. Changing a
  method's list never reaches a sale already recorded.
- **Changing the method swaps the lines that still match the old method's list** — the same supply
  at the same quantity — for the new one's, and keeps the lines the collector changed or added by
  hand. "Untouched" is read off the line rather than stored: a flag would have to be kept in step
  with every edit, and a line edited back to its default is, for every purpose here, the default.
  The rule is the pure `changeMethodSupplies` (`src/lib/method-supplies.ts`), applied by
  `applyMethodSupplies` in the transaction of the write that changed the method.
- **A kept line wins over the new default of the same supply**: a parcel whose cards were raised to
  five by hand does not get two more beside them. A line that is the same in both lists stays as it
  is rather than going back to stock and being taken again.
- **Only a method chosen swaps anything.** Re-saving the same method brings back no default the
  collector removed, and the method dropped when a sale moves to another platform (#468) leaves the
  parcel's supplies where they are — the parcel went as it went.
- A method with no list, or a one-off *Custom* method, fills in none — nothing is guessed (#1692).
- Both references cascade: the list goes with its method, and a supply that may be deleted at all
  (§6) leaves the lists it was on.

## Consequences

- Every reader of an order's money (`getPurchaseDetail`, `closeLot`, the copy estimates, the contact
  page, the Intake documents list) reads the supply lines, so a lot's pool is the same everywhere.
- The agent API's purchase totals include supply lines; it has no operations over them yet.
- #1898 adds the use of supplies (§7): the Supplies screen's quantity on hand is what the batches hold
  after the uses recorded against them, and it says how many units sales are short of.
