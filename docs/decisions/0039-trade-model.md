# ADR-0039: Trades — the Give/Receive Asymmetry and the Frozen Agreement

## Status

Accepted

## Context

Collectors swap stamps. The app records buying (ADR-0009) and selling (ADR-0012/ADR-0013) in detail
and records exchanging not at all, which is a gap in the *acquisition* side as much as in the
disposal side: material that comes in by swap arrives with no cost basis, no record of what it cost
in stamps, and no trace of who it came from.

Three anchors for it already exist and were deliberately reused rather than duplicated:

- `Item.forTrade` — the disposition flag beside `forSale` and `inCollection` (ADR-0007 §4).
- `Contact.exchangePartner` — the partner's role on a contact (ADR-0008).
- `Want` — the `stamp x condition x certificate x format` key with nullable members (ADR-0032),
  which is exactly the shape a "what is coming to me" line needs.

Two obvious models were considered and both are wrong.

**A purchase with a price of zero, or a negative one.** A `Purchase` has one supplier, one currency
and a pool of money spread across its lines (ADR-0009 §3). A trade has neither a price nor a pool:
the consideration *is stamps*, and modelling it as money would require a fictional figure on both
sides that every ROI and cost-basis reader would then take literally.

**A sale paid in goods.** A `Sale` disposes of copies and receives money (ADR-0012). Making the
"money" a bag of stamps breaks the one thing a sale is for — realized proceeds — and would leave the
incoming material with nowhere to live until it is identified, which for a swap is weeks later.

A trade is its own transaction with its own shape, and the shape is unusual enough to be worth
writing down.

## Decisions

### 1. `side` is an axis of the line, not two optional columns on one row

A `TradeLine` carries `side: give | receive` and, depending on it, either an `itemId` or the `Want`
key.

The give side names a **concrete copy**: the stamps are in the collection, a copy is a copy, and
naming anything vaguer would make it impossible to know afterwards what actually left. The receive
side **cannot** name a copy: the partner's stamps are in nobody's inventory, so it names a stamp, a
condition, an optional certificate status, an optional format and a quantity — where, exactly as on a
`Want`, a null certificate status *is* a value ("no certificate", ADR-0006 §2) and a null format
means single.

That asymmetry is why the two sides are one table with a discriminator rather than two nullable FKs
on one row: the shapes genuinely differ, and a CHECK constraint can state which columns each side
may fill. A give line's quantity is always 1 — a multiple is one copy in one format, never N singles
(ADR-0020).

### 2. There is no pairing between the sides

The two sides are two independent bags. The only structure over them is the **section**, and the
counts routinely differ: ten cheap ones for two good ones is a normal value trade. Nothing anywhere
matches a give line to a receive line, and no schema, screen or engine may assume one does.

### 3. A section inherits its balance rule whole, or states its own whole

`TradeSection` carries four nullable override columns, written and cleared as a unit, with
`balanceByValue` as the discriminator: null means inherit everything.

Per-field inheritance was rejected. Two half-inherited settings are two things to keep in step for no
gain, and "tolerance 0 because the trade says so" and "tolerance 0 because this section says so"
would be indistinguishable on screen while behaving identically — a distinction with no consequence
is a distinction that will be got wrong.

Every trade has **at least one section**, created with it, because `TradeLine.sectionId` is required.
A trade with no sections is a trade nothing can be put into; deleting the last one is refused.

### 4. Shipping is two timestamps, not two states

`sentAt` and `receivedAt` are independent and are set in either order. The parcels cross in the post,
and one of them is routinely delayed for a month. Folding them into the linear status would force an
ordering the world does not have — the same split `Purchase` already makes between its delivery
status and its lot lifecycle (ADR-0009 §1/§5).

### 5. The lifecycle is `preparing → shared → agreed → closed`, and `agreed` freezes the list

- `preparing` — composing; nothing has left the building.
- `shared` — the partner's link is live.
- `agreed` — both sides have committed. Valuations freeze and the list locks against editing.
- `closed` — both parcels have arrived and the incoming material has been identified.

`cancelled` is reachable from every live status and leads back to `preparing`; `closed` is terminal
here, because what un-closing would have to undo is the cost basis a close writes.

**The lock at `agreed` is the point of the whole lifecycle.** The partner is holding a copy of the
list. Silently changing what was agreed is how a trade turns into an argument, so recording that
reality diverged — a withdrawal, a shortfall, a substitution — is a **different act with its own
shape**, never an edit made quietly to the thing both sides shook hands on.

### 6. *Partner has responded* is a derived badge, not a status

A negotiation goes back and forth several times. Were "responded" a status, every round would mean
clicking a state back and forth by hand, and the column would record the collector's diligence rather
than the trade. It is derived from partner feedback instead.

### 7. Two valuations, never merged — and the agreed catalog is a **vendor**

A trade carries an optional **agreed catalog** alongside the collector's own valuation, which always
comes from the area's primary catalog exactly as everywhere else in the app. They answer different
questions: what the two sides are negotiating in, and what the collector is actually giving away.
That StampWorld says something different from Fischer is a property of the negotiation, not a
discrepancy to reconcile. The engine that computes them is a separate change; the columns that name
them live on the trade because they are terms of the agreement.

`Trade.catalogVendorId` points at a **`CatalogVendor`** — Michel, StampWorld, Fischer — and
deliberately **not** at a `CatalogName`. A catalog name is one book covering one part of the world:
*Michel Deutschland* prices nothing Polish. A trade routinely spans several areas, so agreeing on a
single book would leave every line outside its scope unvaluable, and the trade would have to carry a
list of books instead — one per area — which is a thing the collection already knows. What two
collectors actually agree on is the publisher ("we go by Michel"), and which volume a given line is
read in then follows from that line's stamp and its area, through the same `CollectionAreaCatalog`
resolution every other valuation in the app uses. One agreed fact, no per-area bookkeeping, and no
way to name a catalog that cannot price half the trade.

The own-valuation skew raises a **warning and never a block**: a deliberately uneven trade is a
normal thing between collectors and the app has no business forbidding it.

### 8. A trade number is a per-collection sequence, never reused

`Trade.tradeNo` is allocated from a counter on `Collection` by the same atomic bump every other short
number uses, and is quoted to somebody else — it heads the partner's copy of the list. Two different
exchanges answering to "trade 7" would be worse here than anywhere.

## Consequences

- A new module: `trade`, `trade_section`, `trade_line`, plus `collection.nextTradeNo`.
- `Contact` gains a `Restrict` guard from `Trade.partnerId`, like every other counterparty link, and
  `Item` gains one from `TradeLine.itemId`: a copy promised to a partner must not vanish from under
  the agreement.
- The disposition flag `Item.forTrade` becomes the default filter of the give-side copy picker; it
  keeps its existing meaning and gains no new one.
- Downstream work — the trade screen, the balancing engine, copy reservation, the partner's share
  link, partner feedback, realisation, the packing list, closing into a purchase, and the Colnect
  list import — all build on this model rather than extending it. Columns those changes read ship
  with them, not here.
