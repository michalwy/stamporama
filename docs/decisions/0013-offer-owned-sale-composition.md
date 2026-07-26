# ADR-0013: Offer-owned sale composition

## Status

Accepted. **Supersedes ADR-0012 §1 (two axes Lot/Offer), §2 (recursive Lot), and §5
(cross-platform coordination).** Carries over unchanged: ADR-0012 §3 (offer lifecycle, since
extended to `preparing → ready → active ↔ paused → sold / withdrawn`; #188, #246), §4 (one currency per offer/sale, FX frozen at the
transaction date), and §6 (proportional P/L allocation engine, `sale-allocation.ts`).

## Context

ADR-0012 modelled a sale as two orthogonal axes: a platform-agnostic **`Lot`** (the package)
listed as **`Offer`s** on each platform (`Lot` **1:N** `Offer`). In practice the *shared*
`Lot` is the wrong coupling:

- Coordination after a sale never actually flowed through the `Lot` — ADR-0012 itself says
  "the `Item` is the thread". The shared `Lot` only ever added coupling on top.
- That coupling makes per-platform reconciliation impossible to express. Selling one sub-lot
  on Colnect leaves the *same* lot's offers on Delcampe/Allegro needing a manual "decrement
  quantity / update photos" action — but there is nowhere to record "I've handled this **on
  this platform**", because the state is shared. Acknowledging it on one offer would wrongly
  clear it on every offer of that lot.
- Editing a `Lot` retroactively mutates every live offer built from it.
- The `unit` vs `quantity` lot recursion (`lot_sub_lot`) is extra machinery for something a
  collector thinks of simply as "this listing has N of these".

There is **no production data** — the entire sales module (#162–#166) merged within the last
handful of commits (v0.18) and nothing has been listed for real yet. So this is a clean schema
replacement, not a data migration.

## Decision

**Collapse `Lot` into `Offer`. Each offer owns its own composition**, mirroring the purchase
model's `Purchase ⊃ PurchaseLot ⊃ Item` containment:

```
Offer   (platformId, url, price, currency, state, …)          — a listing on ONE platform
  1:N
OfferSet (offerId, title?, sortOrder)                          — one atomic sellable unit
  N:M ── Item   via OfferSetItem(offerSetId, itemId, sortOrder?) — the copies in that unit
Sale / SaleLine → offerSetId        (+ sale_line_item.itemId UNIQUE — no-double-sale, unchanged)
```

### 1. Offer owns its content; there is no shared package

`Lot`, `LotItem`, and `LotSubLot` are removed. An offer is composed **directly**: you create
the offer (platform, price, currency), then add its sets. Nothing is shared between offers — the
same three stamps listed on Colnect and Delcampe are **two independent offers**, each with its
own sets. Editing one never touches the other. This is the whole point: **each offer tracks its
platform independently.**

### 2. A `Set` is the atomic sellable unit — no unit/quantity kind

A **set** holds one or more `Item`s that sell **together and indivisibly** (a series / *komplet*
never breaks apart). There is no `kind` discriminator anywhere:

- offer for a single stamp → **1 set, 1 item**
- offer for a single series → **1 set, N items**
- quantity offer → **N sets** (each 1-item or N-item)

Every offer is uniformly "an offer with N sets"; a single-item offer is just the `N = 1` case.
The old `unit` vs `quantity` distinction disappears.

### 3. `Item` stays the cross-platform thread — `OfferSet ↔ Item` is N:M

This is the one place the analogy to `PurchaseLot` (which owns its items 1:N via `item.lotId`)
**does not** hold: a physical copy must be listable on several platforms at once, so
`OfferSetItem` is an **N:M join**, not an owned FK. Selling a copy retires it globally
(`sale_line_item.itemId` UNIQUE — the no-double-sale guard is unchanged), and every *other*
offer whose set still holds that copy surfaces as needing action (§4).

### 4. Cross-platform coordination — per-offer, self-resolving, no stored flag

Derived, no task entity, no marketplace API (as ADR-0012 §5). An **active** offer **needs
action** when any of its sets holds a copy that has already sold (via a different set). Because
each offer owns its sets, the collector **resolves it directly on that offer**, with no shared
state and no acknowledgement watermark:

- **Quantity still available** → open the offer, **remove the dead set** (the one holding the
  sold copy). This *is* the decrement — the offer now lists one fewer. It maps 1:1 to reducing
  the quantity on the platform.
- **Nothing left to sell** (all sets dead / a komplet's set is dead) → **withdraw** the offer.

The signal clears the moment the offer no longer holds a sold copy — nothing to "mark done"
because the resolving edit *is* the record.

**Computed in the database, not in memory.** The derivation is one SQL query returning only the
flagged offers and their dead-copy counts (`needsActionRows` in `src/lib/offers.ts`), used by the
list rows, the "needs action" filter, and the toolbar's filter counts (#332) alike. It started as
an in-memory pass over every active offer with its sets and copy ids, which is a five-figure row
count at the collection sizes this is built for — at 15k active offers / 90k copies that pass cost
~180 ms and grew with the collection on every list render, while the SQL form is ~30 ms and is
dominated by a single scan of each side. Two properties of the query matter and should survive
edits: `sale_line_item` is reached through a plain join (never a materialized CTE) because sales
accumulate without bound and the planner must stay free to probe its UNIQUE `itemId` index instead
of scanning; and the bidding source is pre-grouped **per copy**, so two live auctions on the same
copy flag both offers rather than an arbitrary one.

Because the query always compares against the whole collection, a page of list rows gets correct
flags regardless of which offers share its page — a bid on page 3 flags its twin on page 1.

**Extended for auction platforms (#215).** A bid on an auction listing commits the collector
before a sale is actually recorded — well before the derivation above has anything to key off.
`Offer.inActiveBidding` is a stored boolean, independent of `state`/`sold` and freely revertible,
that the collector sets by hand the moment a bid lands. It plugs into the *same* derivation as a
second source alongside `sale_line_item`: a copy held by another active offer with
`inActiveBidding = true` counts as "needs action" for every *other* active offer holding it, with
no separate flag or watermark on the flagged offers — resolving it (withdraw / remove the set) or
reverting the bidding flag both clear it live, same as the sold case.

### 5. Selling "1 of N interchangeable" binds a specific copy

When a quantity offer sells one of several interchangeable sets, the seller picks which physical
set ships; the sale binds that set's exact copies (whole-set integrity, as today). Default in
the picker: any still-available set. On *other* offers, the now-sold copy makes its containing
set the one to remove (§4) — since the sets are interchangeable, the collector may remove any
equivalent set to decrement.

### 6. Composition is ordered (#306)

Both levels carry an explicit order, because "the second lot" and "second from the left in the
collage" are things a buyer sees, and the generated listing texts and the offer photo plan (#309)
both enumerate the composition:

- `OfferSet.sortOrder` — non-null, dense, 0-based within the offer. Purely explicit: the collector
  drags sets into place, new sets append.
- `OfferSetItem.sortOrder` — **nullable on purpose**. `null` means "derive from the catalog sort
  key" (`stamp.primaryCatalogSortKey`, ADR-0014); a value means the collector hand-corrected it.
  Without the distinction there is no way to tell "this is how catalog order came out" from "this
  is how I want it", and no safe rule for where a newly added copy goes. A set is kept
  all-or-nothing: reordering writes a position for every copy in it, resetting clears them all, and
  a copy added to a hand-ordered set appends while one added to a derived set stays derived.

The comparators live in the pure `offer-set-order.ts` so server reads, duplication, the sale flow
and (later) the photo planner all order a set identically. No read may fall back to cuid order.

## Consequences

- **Removed:** `Lot` / `LotItem` / `LotSubLot` tables and the standalone **Lots** screen,
  routes, and domain (`sale-lots.ts`, lot composition, lot lifecycle `draft/ready/dissolved`).
  Composition moves onto the offer.
- **Reworked:** #162 (schema), #165 (offers now own content), #166 (sale lines target
  `OfferSet`), and #167 (coordination re-expressed per-offer). #164 (lot composition) is
  absorbed into offer composition.
- **Unchanged:** the no-double-sale DB guard, the FX-freeze mechanism, the P/L allocation
  engine (#163) and its unit tests, the offer lifecycle state machine (`offer-rules.ts`).
- **Simplification:** one fewer entity, no recursion, no `kind` invariants, no acknowledgement
  state for coordination.
- **Backlog to revisit** against the new model: #187 (lot-list rows), #188 (add item to a lot),
  #189 (create offer from lot-list row), #190 (lot price pre-fills offer), #176 (lot bulk-action
  scoping) — all lot-centric and reshaped or obsoleted by the collapse.
- **Migration:** none for data (no production data). The schema change drops the lot tables and
  adds `offer_set` / `offer_set_item`; `sale_line.lotId` → `sale_line.offerSetId`.

## Alternatives considered

- **Acknowledgement watermark on the shared `Lot`/`Offer`** (a `syncedUnitCount` the user bumps
  after reconciling a platform). Rejected: it patches the symptom while keeping the shared-state
  coupling that causes it, and re-introduces a stored derived-ish flag the model tried to avoid.
- **Snapshot the lot onto the offer at listing time, keep `Lot` as an authoring template.**
  Preserves "compose once, list everywhere" but keeps a second entity and its lifecycle for
  marginal ergonomic gain; "duplicate an existing offer" (a UX convenience) covers the same need
  without a persistent template.
