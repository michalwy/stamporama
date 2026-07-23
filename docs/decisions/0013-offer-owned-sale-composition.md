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
OfferSet (offerId, title?)                                     — one atomic sellable unit
  N:M ── Item        via OfferSetItem(offerSetId, itemId)      — the copies in that unit
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

### 5. Selling "1 of N interchangeable" binds a specific copy

When a quantity offer sells one of several interchangeable sets, the seller picks which physical
set ships; the sale binds that set's exact copies (whole-set integrity, as today). Default in
the picker: any still-available set. On *other* offers, the now-sold copy makes its containing
set the one to remove (§4) — since the sets are interchangeable, the collector may remove any
equivalent set to decrement.

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
