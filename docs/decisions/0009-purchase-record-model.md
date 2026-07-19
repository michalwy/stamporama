# ADR-0009: Purchase Record Data Model

## Status

Accepted

## Context

A collector buys stamps from dealers, auction houses, private sellers, and online
platforms. A purchase is the primary source of **cost-basis** data (what was paid)
and feeds profit/loss when items are later sold. Until now cost lived as flat fields
on `Item` (`purchasePrice`, `purchaseCurrency`, `acquiredDate`, `contactId`,
ADR-0007) — one independent price per copy, with no concept of a transaction, no
place for shipping or lot-level pricing, and no way to price a lot that resolves into
many copies over time.

A single purchase ranges from one stamp to a whole collection, and intake can span
months: a large lot may be identified copy-by-copy long after the money changed
hands, and some copies may even be sold before the lot is fully worked through. This
ADR fixes the shape of the purchase model and the rules that govern cost allocation
and delivery. It is the design output of #26; implementation is split across
#118–#124.

## Decisions

### 1. Three-level structure plus a non-inventory line

- **`Purchase`** — the transaction header: optional supplier (`Contact`), date, a
  **single transaction currency**, shared costs (shipping), and a delivery status.
- **`PurchaseLot`** — an **inventory** line: a price, an intake status
  (`open | closed`), and the `Item`s it resolves into. A lot may be one stamp, a
  whole issue, an album, or an entire collection.
- **`PurchaseExpense`** — a **non-inventory** line (e.g. a magnifier bought
  alongside the stamps): a label and a price, with no lifecycle and no items.

`PurchaseExpense` is a **separate table** from `PurchaseLot`, not a single line
table with a `kind` discriminator. The two share almost nothing beyond belonging to
a purchase and counting toward the shared-cost weight base; a discriminator would
leave `status`/`items` meaningless for half the rows and would let `Item` point at a
non-inventory line. Two tables keep the invariants honest — `Item` FKs **only** to
`PurchaseLot`, and `PurchaseExpense.price` is always present. The small cost is that
the allocation engine reads both tables to build the shared-cost weight base.

### 2. Purchase is one acquisition channel — the `Item` link is optional

`Item.lotId` is a **nullable** FK to `PurchaseLot`. A purchase is only one way a copy
enters the collection; a future trade/exchange module (and gifts/inheritance/finds)
will attach cost differently. An item with no lot has a `null` cost-basis, which is a
legitimate state.

Cost-basis is therefore stored as a **base-currency snapshot on `Item`**, written by
whichever channel produced the copy, so profit/loss reporting is uniform and does not
have to walk channel-specific links. This supersedes the flat cost fields on `Item`
from ADR-0007 — supplier, date, and price now live on `Purchase`/`PurchaseLot`.

### 3. Cost allocation

1. **Shared costs** (shipping) are distributed across **all** lines
   (`PurchaseLot` + `PurchaseExpense`) proportionally to line **price**, so a
   non-inventory line absorbs its fair share and does not inflate the stamps.
2. A lot's **pool** = its price + its share of shared costs.
3. On **lot close**, the pool is distributed to the lot's items proportionally to the
   **primary-catalog price for each item's condition × certificate**
   (ADR-0006 multidimensional prices).
4. The result is **frozen** as the per-item snapshot; later catalog-price drift does
   not change it.
5. A **structural** change to a closed lot — membership change, or a variant
   reassignment (`ItemVariantHistory`, ADR-0007) — **recomputes** the allocation and
   overwrites affected snapshots. Retroactively changing the cost-basis of an
   already-sold item is accepted.

### 4. Currency

One currency per `Purchase`. Amounts are stored in the transaction currency; the
base-currency equivalent uses the FX rate **frozen as of the purchase date** (the
moment money was spent), reusing the `ExchangeRate` mechanism from the currency work
(#20). Original amounts are preserved.

### 5. Two orthogonal lifecycles

**Intake / allocation** lives on `PurchaseLot`: `open → closed`.

- While a lot is `open`, its items' cost-basis is **pending** (`null`), and items may
  be **sold before the lot closes** — the cost is simply not yet known.
- Intake of an item means creating (or linking) an `Issue` + `Stamp` + `Item` in the
  correct condition **and assigning a storage location** (#55/#56).
- Closing a lot is **blocked** if any item lacks a primary-catalog price for its
  condition × certificate; the collector is told which items are missing a price.

**Physical delivery** is a separate axis. `Purchase.status` is
`preparing | in_transit | arrived` at the header, and each `Item` carries an
independent **`deliveryState`** = `in_transit | delivered | not_delivered | damaged`.
This axis is orthogonal to `inCollection` and `forSale`/`forTrade` (a copy can be
`in_transit` and already `forSale`). A lot may be **closed before the shipment
physically arrives**.

- **Not-delivered** → the item is removed from its lot and its share **redistributes**
  to the survivors (typically a refund or a copy that never came).
- **Damaged (write-off)** → the item **stays**, keeps its cost-basis, and becomes a
  P/L **loss** — a ruined copy that was paid for does not make the others cost more.

### 6. Auctions are decoupled

The auction data model (#23) does **not** gate this feature. A loose future link — a
lot optionally referencing an auction lot — is left to #23.

## Schema

```
Purchase
  id
  collectionId   → Collection  (onDelete: Cascade)
  contactId      → Contact?     (onDelete: Restrict)   -- optional supplier
  purchasedAt    Date
  currency       String                                -- transaction currency
  fxRateToBase   Decimal?                              -- frozen at purchasedAt
  shippingCost   Decimal?                              -- shared cost
  status         enum  preparing | in_transit | arrived
  createdAt

PurchaseLot
  id
  purchaseId     → Purchase     (onDelete: Cascade)
  price          Decimal
  status         enum  open | closed
  -- items: Item[]

PurchaseExpense
  id
  purchaseId     → Purchase     (onDelete: Cascade)
  label          String
  price          Decimal

Item  (additions to ADR-0007)
  lotId          → PurchaseLot?  (onDelete: Restrict)  -- optional acquisition link
  deliveryState  enum  in_transit | delivered | not_delivered | damaged
  costBasis      Decimal?        -- base-currency snapshot, null = pending
```

Exact column names, precision, currency-code handling, and the precise naming of the
three cost concepts (shared cost vs `PurchaseLot` vs `PurchaseExpense`) are settled in
the schema issue (#118). The allocation logic lives in a pure module unit-tested
without Prisma (#119).

## Consequences

- Cost-basis becomes a first-class, channel-agnostic snapshot on `Item`; the flat
  cost fields from ADR-0007 are migrated into the purchase model.
- Storage locations (#55/#56) become a **prerequisite**: intake assigns a location to
  each received copy; both were raised low → medium priority.
- Reporting must treat a `null` cost-basis as *pending*, not zero, and must tolerate
  retroactive changes when a closed lot is corrected.
- The trade/exchange layer will write the same `Item.costBasis` snapshot through its
  own path, keeping profit/loss uniform.
- Implementation is tracked in #118 (schema + this ADR), #119 (allocation engine),
  #120 (CRUD), #121 (intake/lifecycle), #122 (delivery/write-off/recompute), #123
  (cost-basis surfacing + P/L hook), #124 (demo data).
