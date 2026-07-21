# ADR-0012: Sales Record Data Model

## Status

Accepted

## Context

A collector sells stamps — individually or in sets — across several marketplaces at once
(e.g. Delcampe, Allegro, Colnect). When a copy sells on one platform it must come off the
others. Multi-item packages (*lots*) are composed from inventory copies, listed as a unit,
and dissolved if they do not sell. Profit/loss requires the original purchase cost per copy,
which already lives on `Item.costBasis` as a base-currency snapshot (ADR-0009).

This ADR fixes the shape of the sales model and the rules that govern lot composition,
per-platform listing, the sale transaction, and P/L allocation. It is the design output of
#29; implementation is split across #162 (this ADR + schema), #163 (allocation engine), and
#164–#169 (composition, offers, sale flow, coordination, P/L surfacing, demo data). It is
deliberately **symmetric to the purchase model** (ADR-0009): two orthogonal axes, a single
transaction currency with FX frozen at the transaction date, and a pure proportional
allocation engine unit-tested without Prisma.

## Decisions

### 1. Two axes: package (`Lot`) vs platform (`Offer`)

Sales are built around two orthogonal concepts, mirroring the purchase model:

- **`Lot`** — a **platform-agnostic package** the collector composes from inventory copies.
  This is *what* is being sold, independent of *where*.
- **`Offer`** — a `Lot` listed **on one platform** (a `Contact` with the `platform` role):
  listing URL, asking price, currency, state. `Lot` **1:N** `Offer` — the same package listed
  on Delcampe, Allegro, and Colnect simultaneously.
- **`Sale`** — the **transaction** created when a lot sells on a platform: single platform,
  single currency, carrying the FX date.

The **`Item` is the thread** that ties platforms together, not a shared listing record.
Cross-platform coordination (§5) hangs off the shared copy.

### 2. `Lot` is recursive — unit vs quantity

`Lot` is recursive along a `kind` discriminator:

- a **unit lot** (`kind = "unit"`) — the atomic sellable unit: a single stamp, or a single
  series sold together (a *komplet* — several *different* stamps, **indivisible** inside).
  Holds `Item`s directly via the `lot_item` join.
- a **quantity lot** (`kind = "quantity"`) — groups **N interchangeable sub-lots of the same
  shape** via the `lot_sub_lot` self relation, and holds **no items directly**.

**Membership is N:M.** `Item` **N:M** `Lot` (`lot_item`): the same physical copy can be
packaged differently per platform (stamp X solo on Delcampe, and X+Y as a komplet on Colnect).
The quantity-lot ↔ sub-lot relation is likewise N:M (`lot_sub_lot`).

**Divisibility.** A unit lot is atomic (a komplet never splits). A quantity lot is divisible
**by whole sub-lots** — a buyer taking K units consumes K entire sub-lots, so a series never
breaks apart.

The kind invariants (unit lots hold items and no sub-lots; quantity lots hold sub-lots and no
items) are **domain guards**, not DB constraints — they span the two join tables and cannot be
expressed as a single check.

**Shape / interchangeability (#164).** A sub-lot's *shape* is the sorted multiset of its copies'
**stamp × condition** components. Every sub-lot of one quantity lot must share the same shape —
the first added sub-lot fixes it. **Condition must match** (part of the shape, enforced);
**certificate is not** — a certificate difference is a non-blocking **warning** surfaced in the
picker, since certs don't change interchangeability enough to forbid grouping. A **physical copy
appears in at most one sub-lot** of a quantity lot (you can't sell the same copy twice as two
interchangeable units) — a domain guard on both add paths, spanning the sub-lots' `lot_item`
rows. The composition UI
builds a quantity lot two ways: **add copies** (each selected copy becomes its own `ready`
single-stamp unit sub-lot — the fast path for a stock of duplicates, so all picked copies must
be the same stamp) and **add lots** (attach existing unit lots whose shape matches). Copies
must be *For sale* and *delivered* to be packaged. A grouped unit lot **still lists** on the
top-level Lots screen (flagged "in quantity lot", with a "Hide grouped" toggle) — it can be
offered standalone, and the no-double-sale guard means whichever sale lands first takes the
copy. Auto-created single-copy sub-lots are cleaned up when ungrouped **unless** they've since
gained a title, another parent, an offer, or a sale.

### 3. Explicit lifecycles

**`Lot.state`: `draft ↔ ready ↔ dissolved`.** `dissolved` = unpacked back into inventory
because it did not sell. **`sold` / `partially-sold` are derived**, never stored — they are
computed from sub-lot and item state, so there is no duplicated source of truth (symmetric to
purchases deriving lot totals rather than storing them).

**`Offer.state`: `active ↔ paused → sold / withdrawn`.** `paused` = temporarily suspended on
the platform, with the copies still committed to the lot. No `reserved`/negotiation states in
v1. A **derived "to-close" flag** overlays `active` (§5).

### 4. Currency

One currency per `Sale`, and one per `Offer` (platforms price independently, so an offer
carries its own `price` + `currency`). Amounts are stored in the transaction currency; the
base-currency equivalent uses the FX rate **frozen as of the sale date**, reusing the
`ExchangeRate` mechanism (#20). Original amounts are preserved. Symmetric to ADR-0009 §4.

### 5. Cross-platform coordination — derived, no tasks, no API

No task/notification entity and no marketplace API integration. Selling a copy/sub-lot marks
colliding **active** offers on other platforms with a **derived "to-close" state** — an active
offer that contains an already-sold item or an unavailable sub-lot. The offers list carries a
**"to-close" filter**; the collector withdraws each offer manually (`withdrawn`) after removing
it on the platform. The model does not preclude a future API.

**Invariants / guards:**

- **No double sale** — a copy sells at most once. This is the one invariant expressible in the
  DB: a **`UNIQUE` on `sale_line_item.itemId`**. Once a copy leaves via a sale, remaining
  lots/offers holding it surface in the to-close filter.
- **At most one active offer per (`Item` × platform)** — warn when listing a copy that already
  has an active offer on that platform. Domain guard (spans `lot_item` × `offer.state`).
- **Quantity decrement** — selling a sub-lot decrements available quantity in every quantity
  lot that contains it. Derived.

### 6. Profit / loss allocation

Symmetric to the purchase cost-allocation engine (ADR-0009 §3, `purchase-allocation.ts`), with
the money flowing the other way. The pure engine is `src/lib/sale-allocation.ts` (#163),
unit-tested without Prisma; the server (#166/#168) assembles inputs and surfaces the result.

1. A sale's three **shared amounts** are each distributed across **all** lines proportionally
   to line **sale price**: buyer-paid handling (`+`), my actual shipping (`−`), and platform
   commission (`−`, entered **manually** per transaction). Each is a non-negative amount split
   by the same price weights, so the largest-remainder apportionment from purchases applies
   unchanged.
2. A line's **net proceeds** (transaction currency) = `price + handlingShare − shippingShare −
   commissionShare`. This may be **negative** (a line whose fees exceed its price).
3. The net is converted to base currency at the frozen FX rate, then distributed to the line's
   `Item`s proportionally to the **primary-catalog price for each item's condition ×
   certificate** (ADR-0006) — the same weight the purchase engine uses, so a komplet's copies
   split symmetrically. A single-item line short-circuits (the copy takes the whole net).
4. Per copy: **P/L = net proceeds (base) − `Item.costBasis` (base)**. A `null` cost-basis
   (lot still open / channel wrote no cost) yields a `null` P/L — reporting treats that as *not
   yet computable*, never phantom profit (consistent with `resolveCostBasis`, ADR-0009).

**Rounding.** Everything reconciles to the cent via integer-cent largest-remainder
apportionment: each shared amount's shares sum exactly to that amount, and per-item proceeds
sum exactly to the line's base-currency net. A negative net is apportioned by magnitude and
re-signed.

### 7. Buyer, auctions, and returns are out of scope for v1

The `Sale` records the platform, not a buyer `Contact` — a buyer entity is not among the v1
fields and is left unmodeled to avoid inventing requirements. Auction integration (#23) and
returns/refunds are not modeled here; the schema does not preclude adding them.

## Schema

Landed in #162 (`prisma/schema.prisma`, migration `20260721000000_add_sales_model`).

**Enum representation.** As elsewhere, the schema uses no native Postgres enums; every state is
a `String` column with allowed values documented in the schema and enforced by the domain
layer.

**Decimal precision.** Money uses `Decimal @db.Decimal(10, 2)`. `fxRateToBase` carries no
annotation, inheriting Prisma's default `Decimal(65, 30)` — the same precision as
`ExchangeRate.rate`.

```
Lot                                              -- table "lot"
  id            String   @id @default(cuid())
  collectionId  String   → Collection  (onDelete: Cascade)
  kind          String                            -- unit | quantity
  state         String   @default("draft")        -- draft | ready | dissolved
  title         String?
  createdAt     DateTime @default(now())
  -- items:   LotItem[]     (unit lots)
  -- subLots: LotSubLot[]   as parent  (quantity lots)

LotItem                                          -- table "lot_item"  (Item N:M Lot)
  lotId  String  → Lot   (onDelete: Cascade)
  itemId String  → Item  (onDelete: Cascade)
  @@id([lotId, itemId])

LotSubLot                                        -- table "lot_sub_lot"  (quantity lot ↔ sub-lot)
  parentLotId String → Lot (onDelete: Cascade)
  childLotId  String → Lot (onDelete: Cascade)
  @@id([parentLotId, childLotId])

Offer                                            -- table "offer"
  id            String   @id @default(cuid())
  collectionId  String   → Collection  (onDelete: Cascade)
  lotId         String   → Lot          (onDelete: Cascade)
  platformId    String   → Contact       (onDelete: Restrict)   -- platform-role contact
  url           String?
  price         Decimal  @db.Decimal(10, 2)
  currency      String
  state         String   @default("active")      -- active | paused | sold | withdrawn
  createdAt     DateTime @default(now())

Sale                                             -- table "sale"
  id            String   @id @default(cuid())
  collectionId  String   → Collection  (onDelete: Cascade)
  platformId    String   → Contact       (onDelete: Restrict)
  soldAt        DateTime @db.Date                 -- FX frozen at this date
  currency      String
  fxRateToBase  Decimal?                          -- DECIMAL(65,30)
  buyerHandling Decimal? @db.Decimal(10, 2)       -- + proceeds
  shippingCost  Decimal? @db.Decimal(10, 2)       -- − my cost
  commission    Decimal? @db.Decimal(10, 2)       -- − manual
  createdAt     DateTime @default(now())

SaleLine                                         -- table "sale_line"
  id      String   @id @default(cuid())
  saleId  String   → Sale   (onDelete: Cascade)
  offerId String?  → Offer  (onDelete: SetNull)   -- historical sale survives offer cleanup
  lotId   String   → Lot    (onDelete: Restrict)  -- the unit lot or sub-lot sold
  price   Decimal  @db.Decimal(10, 2)             -- line sale price, sale currency

SaleLineItem                                     -- table "sale_line_item"
  saleLineId String → SaleLine (onDelete: Cascade)
  itemId     String → Item     (onDelete: Restrict)
  @@id([saleLineId, itemId])
  @@unique([itemId])                              -- no double sale (DB-level guard)
```

`Item` gains two back-relations (`lotMemberships: LotItem[]`, `saleLineItems: SaleLineItem[]`);
`Contact` gains `offers` (platform) and `salesPlatform`; `Collection` gains `lots` / `offers`
/ `sales`. No columns were added to `Item` — sold state is read through the `sale_line_item`
join, not a flag, keeping it a single source of truth.

## Consequences

- Sales reuse the `Item.costBasis` snapshot and the FX/`ExchangeRate` mechanism, so P/L is
  uniform across acquisition channels (purchase today, trade later).
- The recursive-lot kind invariants and the "one active offer per (item × platform)" guard live
  in the domain layer; only no-double-sale is a DB constraint.
- Derived lot/offer states (`sold`, `partially-sold`, `to-close`) must be computed on read; no
  background job keeps a stored flag in sync.
- Implementation is tracked in #162 (schema + this ADR), #163 (allocation engine), #164 (lot
  composition), #165 (offers), #166 (sale flow), #167 (coordination), #168 (P/L surfacing),
  #169 (demo data).
