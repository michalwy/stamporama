# Overview Screen

The collection Overview at `/c/[collectionSlug]` — the financial and progress picture (#397;
built by #649–#651).

- **The screen is an entry point, never a reports area** (#397). Two sections on one screen —
  **Value** (money) and **Progress** (coverage, growth, gaps) — as tile grids, and **every tile
  links into the list screen that holds the underlying rows with the filter applied**. No
  `/reports` tree, no new sidebar section, and nothing operational: the action-items bell (#367)
  already aggregates what needs doing, and a dashboard repeating it would be a second version of
  the same list drifting apart from it. The links are ordinary URL filters the target screens
  already parse (`/offers?state=active`, `/issues?areaId=…`, `/inventory?sortBy=created`), so a
  tile and its screen cannot disagree about what the figure ranges over — which is also why each
  figure is computed over the target's **default scope** (holdings over `excludeGone`, exposure
  over the watchlist's open lots, asking over `state=active` exactly).

  **One tile opens a screen that is not a list**: *Realized profit and loss* opens
  `/sales/profit-and-loss` (#1305), because no list holds a profit — the Sales list was deliberately
  left without a profit column (#168), and the collector chose a dedicated screen over adding one
  (2026-09-15). It sits under Sales rather than a `/reports` tree, and is reached from the tile, not
  the sidebar. The agreement the rule above protects still holds, by construction rather than by a
  shared URL filter: the screen's default scope is every sale, and both it and the tile read
  `listSaleProfitRows` (`sales.ts`).

- **Aggregate here, detail elsewhere** (#397). The two reads — `getOverviewValue` /
  `getOverviewProgress` in `src/lib/overview.ts`, one API route each under
  `overview/value|progress` so each section loads and skeletons on its own — are compositions of
  reads that already exist (`getHoldingsValuation`, `offersSummary`, `auctionLotExposure`,
  `realizedProfit`, `summarizePurchaseReturn`, `listIssueGroupCompleteness`,
  `wantCatalogRange` via `openWantGapSummary`), never re-derived arithmetic. The tile arithmetic that is new (growth series, checklist tally,
  area rollup, purchase classification) is pure in `src/lib/overview-rules.ts`, unit-tested
  without Prisma.

- **One allocation pass, grouped** — `realizedProceedsByGroup` (`sales.ts`) exists for the
  purchase-ROI tile: the per-purchase question over every purchase at once, where calling
  `realizedProceedsForItems` per purchase would load every touched sale once per purchase (the
  N+1 #650 forbids; #174's shape). The single-item-set read now delegates to it, so the
  whole-line-carried rule (`attributeLineToPurchase`) is judged per group and cannot drift
  between the two.

- **Realized profit is the sale screens added up** (#168). `realizedProfit` (`sales.ts`) runs
  every sale through the same `profitOfSales` the sale screen reads and sums the figures with
  `sumProfitFigures` (`sale-profit.ts`), so the tile and the screens agree by construction — which is
  why the tile's figure moved when #168 landed. Before it, the tile took **every** sold copy's
  proceeds and subtracted only the **known** costs, so a copy with its cost pending counted as pure
  profit and a sale with no exchange rate was read at a rate of 1. Settled with the collector on
  2026-09-15: one rule, and a copy that cannot be counted — no rate, cost pending, no cost, an
  unsplittable share — is left out of **both** sides and counted by why on the tile. Purchase ROI
  (`realizedProceedsByGroup`) still attributes proceeds without the no-rate exclusion; it answers a
  per-order question and was not part of #168. **Opening balances are not purchases**: the ROI tally
  reads purchase lots only, and the holdings tile names an opening value beside the cost and measures
  the surplus against both (#1324, see `purchases-and-intake.md`). Since #1305 `realizedProfit` sums
  `listSaleProfitRows`, the per-sale read the profit and loss screen lists, so the tile and that
  screen's all-dates total are one read.

- **Honest gaps, everywhere** (#650/#651). Unpriced and unconvertible rows are counted apart on
  the tiles, never silently dropped — `offer-summary.ts`'s own separation. Catalogue value and
  market value are never summed into one figure; asking (money in) and auction exposure (money
  out) are stated side by side for the same reason. A root area with no checklist in its subtree
  is **not tracked**, never 100% — coverage is only meaningful where a checklist defines the
  denominator. An empty tile says what would fill it, not "0" (#649).

- **A want gap is judged by `wantMatchesCopy`**, not by openness alone: `openWantGapSummary`
  (`wants.ts`) counts an open want as a gap only when no counted copy in hand (held **or**
  `to_sort` — the want chip's own fold) satisfies the acceptance, and reports satisfying copies
  already ordered/in transit as *on the way* rather than pretending the gap is untouched
  (ADR-0032 §7's reasoning). Only the gap wants are priced, one `loadCatalogRanges` pass.

- **Growth is event dates, no new storage** (#397): `Item.createdAt` / `Issue.createdAt` bucketed
  by UTC month in SQL (`date_trunc`), the window filled with zero months by the pure
  `buildGrowthSeries`. The value of the holdings on a past day is unrecoverable from current
  state — so it is recorded as it happens by #652's daily snapshots
  (`value-snapshots.ts`, [ADR-0053](../decisions/0053-daily-collection-value-snapshots.md)), taken
  from this screen's own Value reads at their own scopes so a snapshot and the tile read the same
  day cannot disagree. The chart over them is #653, below.

- **Value over time reads stored rows only** (#653; ADR-0053). `getOverviewValueHistory`
  (`overview.ts`) returns every recorded snapshot row as written — never re-valued — through its own
  `overview/value-history` route and query, so the chart loads and fails apart from the tiles. The
  series rules are pure in `src/lib/value-history-rules.ts`: a **missing day breaks the line**
  (`splitIntoRuns`, nothing interpolated, a lone point drawn as a dot); **fewer than two days is a
  waiting state**, not an empty frame; days recorded under **another base currency are counted
  apart** and not plotted, since re-converting them at today's rate would be today's claim.
  The chart is catalogue value and acquisition cost on one zero-based axis — catalogue value is the
  Holdings tile's headline, and market value stays off it rather than being mixed in.
  - **The area split is lines, never stacked bands** — settled with the collector on #653, against
    the issue body's "stackable". An area row is its subtree and a stamp filed in two areas counts
    under both (ADR-0053 §3), so bands would claim a sum that does not hold. The split is over
    **top-level areas** that held a non-zero value on some day; a root with no row on a day (created
    later) breaks its own line there.
  - **The chart is the one element that is not a tile**: no list screen holds a history to link
    into, so the drawing is not a link. Since #1330 each **area name in the readout** is one, to
    `/inventory?areaId=…` — settled with the collector on 2026-09-16, the name rather than the line
    because a polyline is no target to aim at. Its split toggle is local state rather than URL
    state — a view of one card, not a filter of rows. **Plain SVG, no charting library** — a few
    polylines, a hover guide and a ResizeObserver width do not warrant a dependency (and so no ADR).

- **The collector chooses the areas the Overview breaks down by** (#1330), because a tree
  organised by continent makes the top level say nothing. Settled with the collector on
  2026-09-16:
  - **Saved for the collection, chosen on the Overview itself**: `CollectionOverviewArea` rows,
    read by `overview-areas.ts`, written by `saveOverviewAreasAction`, picked in
    `overview-areas-dialog.tsx`. **No rows is the default — top-level areas**, so a collection that
    never opens the control sees no change; a chosen area deleted cascades out of the choice.
  - **One choice, both sections**: `resolveAreaBreakdown` (`overview-rules.ts`) is the only place a
    choice meets the tree, and both `getOverviewValueHistory` and `rollUpAreaCoverage` go through it,
    so Value over time and Coverage by area cannot split differently.
  - **Any depth, each area its whole subtree, a nested pair allowed** — each its own line, nothing
    summed across overlapping lines.
  - **Other is everything under none of the chosen areas, and "reconcile" means nothing drops
    out**, not that the lines add up: a stamp filed in two chosen areas counts under both, so the
    lines can exceed the total. The arithmetic alternative (total minus the areas) was rejected — it
    goes wrong, even negative, on exactly those stamps. A copy linked into a chosen subtree by *any*
    of its links is not Other's (`copyIdsOutsideSubtrees`); a copy in no area is.
  - **Other has no history** on the chart. Snapshots record per-area subtrees, not "outside a
    choice", and it cannot be derived from them for the reason above. Recording it going forward was
    offered and declined: it is **today's figure, valued live** (`getHoldingsValuationOutsideAreas`,
    at the snapshot's own scope) and stated in the readout — the one figure the chart does not read
    from stored rows (ADR-0053 carries the note).
  - **Other is not a link** anywhere: no list filter selects "the rest", and a link to the
    unfiltered list would open rows other than the ones it counts.
  - **A chosen area's history reaches back as far as its rows do**; `historyFrom` is its first
    recorded day, and the chart draws a dotted marker there and reads earlier days as *not recorded
    yet* instead of zero. A chosen area is kept even if it never held value — the collector asked
    for it — where the top-level default still drops the all-zero ones.

- **Tiles are `RowLink` cards** (#557's overlay): the whole tile navigates, and an inner link —
  the exposure line to `/auctions`, a coverage row to its area — is lifted with `ROW_LINK_ABOVE`.
  Sections skeleton independently in their final geometry (#151), through their own two queries
  under the `["overview", collectionId, …]` key — its own root, so no list mutation invalidates
  it; the figures refresh on the shared stale clock.
