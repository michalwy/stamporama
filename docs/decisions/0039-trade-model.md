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
discrepancy to reconcile. The columns that name them live on the trade because they are terms of the
agreement.

**Revised in place by #638**, which built the engine this section anticipated, on the ADR-0029 §8
precedent — the decision below is unchanged and what follows is the shape it took rather than a
contradiction of it.

Own valuation is `valuateItemRows` **called, not restated**: the identical function the copies list
prices a copy with, with no override of any kind, so the trade screen cannot quote a different figure
for a stamp than the rest of the app does. Agreed valuation is the same call against a different
book, through one swapped input — the area → catalogue map (`buildVendorCatalogMap`) — because the
rollup, the format factors, the edition selection and the strict certificate match are the *same*
rule asked of a different publisher, and a second valuator would be two copies of ADR-0020 and #238
to keep in step. A **per-line** vendor may override the trade's ("this one we look up in Fischer");
it is one more map and one more pass, never a second rule, and it touches the agreed valuation only.

Three things follow from "never merged". They are summed apart (`trade-balance.ts` keeps two fields
of two units rather than one field and a flag), they are printed apart in two named currencies, and
a **missing figure is counted, never assumed to be zero** — which is what the gate is. A trade may
not leave `preparing`, nor reach `agreed`, while any line on either side has no own valuation at all;
the check is re-run on every attempt rather than stamped once, and it refuses **by name** (#418's
shape). An unknown-variant rollup (#238) satisfies it, flagged as the estimate it is: blocking on one
would throw every umbrella stamp out of every trade, and a negotiating figure claims nothing of what
a listing claims (#617). `TradeLine.manualValue` satisfies it too, in the base currency and marked as
the collector's own figure wherever it is shown — material no catalog prices must not deadlock a
trade, and that is categorically different from the zero the app refuses to assume. The agreed gate
applies only where value balancing decides, and a value-balanced trade naming *no* catalog is refused
as the one fault it is rather than as every line being blamed for a figure nothing was asked for.

**Freezing is by status, and there are three regimes.** `preparing` reads live catalogs at live
rates. The first move to `shared` writes `TradeFxRate` — `ExchangeRate`'s own shape with the
collection swapped for a trade, keyed on `(tradeId, fromCurrency, toCurrency)` because a trade
converts toward two targets and one row cannot mean both — refreshable while the negotiation runs and
hard-frozen at `agreed`. `agreed` writes `TradeLineValuation`, one row per `(line, kind)`: `kind` is
an axis for §1's reason, and the catalogue's name and currency are stored as **text** rather than as
foreign keys, because the whole point is that a catalog renamed or deleted next week cannot restate
what two people shook hands on. The snapshot is **released** whenever the trade returns to a status
its list can be edited in — what is editable is not frozen, and a snapshot shadowing a live edit is
the one way that table could lie.

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
- #638 shipped its own, per that rule: `trade_line.manualValue` and `trade_line.catalogVendorId`
  (the two escape hatches), `trade_line_valuation` (the freeze) and `trade_fx_rate` (the rates). It
  also lifted the three access guards into `trade-access.ts`, below both halves of the domain, so
  that `trades.ts` calling the engine's gate and the engine calling those guards is not a cycle —
  the same move `item-valuation.ts` made for `items.ts` and `market-values.ts`.
- `CopyValuation` gained `catalogNameId` and `editionYear`. Every other reader ignores them; the
  freeze needs them, because a snapshot recording an amount but not the book and edition behind it is
  a number the partner's printout can never be checked against.
