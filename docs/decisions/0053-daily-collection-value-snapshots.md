# ADR-0053: Daily Collection Value Snapshots

## Status

Accepted and implemented in #652. Decided in #397, which chose to record history rather than
reconstruct it; the chart that reads these rows is #653.

## Context

The Overview (#649–#651) states what the collection is worth today. A curve of that figure over time
needs its past values, and two kinds of history behave differently:

- **Growth is derivable.** Copies and issues added per month, and spend, fall out of event dates
  (`Item.createdAt`, `Issue.createdAt`, `Purchase.date`) that are stored anyway. The Overview's growth
  tile computes it on read with no new storage.
- **Value is not.** What the holdings were worth on a past day depends on which copies were held that
  day, what the catalogues priced them at, what the market had paid, what was listed and bid on, and
  the rates everything was converted with. Every one of those has moved since, and nothing keeps what
  it was. Asking current state about a past day returns today's answer with an old date on it.

So the value side has to be written down on the day, or it is gone.

## Decision

### 1. Two tables: a collection row per day, an area row per day under it

`CollectionValueSnapshot` holds one row per `(collectionId, day)`; `CollectionAreaValueSnapshot` one
per `(snapshotId, collectionAreaId)`. Both keys are real unique indexes.

A single table keyed `(collectionId, areaId?, day)` was the alternative and was rejected because
Postgres treats NULLs as distinct in a unique index: the collection row — the one with no area — could
be inserted any number of times for one day, and *a restart does not double a point* is the
requirement.

`day` is the **UTC** calendar day, as the growth tile's months are UTC.

### 2. Every figure is a read that already exists, at the Overview's own scope

The collection row is the Overview's Value section at the moment of the pass, taken from the same
reads rather than re-derived:

- **Holdings** — catalogue value, market value, acquisition cost, copies held — from the holdings
  summary over `excludeGone` (`getHoldingsValuation`'s scope), each sum stored **with the counts that
  say what it left out**: unpriced, unconvertible and variant-uncertain copies beside the catalogue
  value, copies with no market evidence beside the market value, pending and unrecorded cost beside
  the cost. A point on a curve that silently dropped thirty unpriced copies would be a different claim
  from one that says so. The write-off side is not stored: a copy that is gone is not part of what the
  collection was worth that day.
- **Asking value** — `offersSummary` over `state=active`.
- **Auction exposure** — `auctionLotExposure` over the watchlist's open lots, committed and ceiling.

Catalogue and market value stay two columns, as they stay two figures on the tile.

### 3. Areas carry holdings only, over the area's subtree

An area row carries the holdings figures for **the area's subtree** — exactly what the Copies screen
sums with that area selected (#385): every copy whose stamp is linked into the area or anything under
it. A stamp filed in two areas counts under both, so area rows need not add up to the collection row;
that is already true of the Copies rail.

Stored per subtree, not per area and rolled up on read, so that moving an area in the tree later does
not rewrite what its history said.

**Asking value and exposure are not split by area** (settled with the collector on #652). An offer or
an auction lot can mix copies of several areas, and every way of dividing its amount — all-or-nothing,
proportional to catalogue value — invents an allocation nobody made.

An area deleted takes its own rows with it (`ON DELETE CASCADE`); the collection's rows are untouched.

### 4. The rates are recorded beside the figures

Every money column is in the collection's `baseCurrency`. The row also stores `rates` — the
collection's exchange-rate table at the pass, restated as `currency → rate into the base` — and
`ratesFetchedAt`, the date of that table (null when the collection holds none).

The table is read **after** the figures, so a stale table refreshed by a conversion during the pass is
the one recorded. A snapshot has to stay readable after rates move: a figure re-converted at today's
rate would be today's claim, which is the thing this ADR exists to avoid.

### 5. An hourly in-process sweep, idempotent per day, with gaps left as gaps

The sweep is the photo orphan GC's shape (#112): started from `src/instrumentation.ts` `register()`,
once shortly after boot and then hourly, stateless, with its timers and in-flight flag pinned to
`globalThis` so `next dev` hot reloads cannot stack a second interval.

A pass **upserts** the day's collection row and replaces its area rows whole in one transaction, so a
second pass the same day updates the point rather than adding one, and the row that stands for a day
is the last pass of that day. Hourly rather than daily so a day is recorded even when the app runs for
only part of it.

**A day the app was not running is a gap, and stays one.** Nothing can reconstruct it, and a
back-filled point would be today's state wearing an old date.

### 6. Retention: kept indefinitely

A row per collection and per area per day is small, and the long series is the whole point. A cap,
if one is ever wanted, is a later decision.

## Consequences

- The chart (#653) reads stored rows only; it never calls the valuation. **One exception since
  #1330**: with areas chosen for the breakdown, *Other* — every copy under none of them — is valued
  live and shown for today only. No row records it, and it cannot be derived from the area rows,
  since a stamp filed in two areas counts under both; it is drawn as no line at all rather than as a
  history reconstructed from current state.
- A figure's definition is fixed by what the Overview read at the time. If a read's scope changes
  later, older rows keep the old meaning — the price of recording rather than reconstructing.
- Each hourly pass costs one Overview Value read per collection (without the realized and purchase
  tiles). Areas add aggregation, not valuation: the copies are valued once and sliced.
