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

- **Aggregate here, detail elsewhere** (#397). The two reads — `getOverviewValue` /
  `getOverviewProgress` in `src/lib/overview.ts`, one API route each under
  `overview/value|progress` so each section loads and skeletons on its own — are compositions of
  reads that already exist (`getHoldingsValuation`, `offersSummary`, `auctionLotExposure`,
  `realizedProceedsForItems`, `summarizePurchaseReturn`, `listIssueGroupCompleteness`,
  `wantCatalogRange` via `openWantGapSummary`), never re-derived arithmetic. Per-item and
  per-sale P/L remains #168. The tile arithmetic that is new (growth series, checklist tally,
  area rollup, purchase classification) is pure in `src/lib/overview-rules.ts`, unit-tested
  without Prisma.

- **One allocation pass, grouped** — `realizedProceedsByGroup` (`sales.ts`) exists for the
  purchase-ROI tile: the per-purchase question over every purchase at once, where calling
  `realizedProceedsForItems` per purchase would load every touched sale once per purchase (the
  N+1 #650 forbids; #174's shape). The single-item-set read now delegates to it, so the
  whole-line-carried rule (`attributeLineToPurchase`) is judged per group and cannot drift
  between the two.

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
  state — that is #652's daily snapshots, and the chart over them is #653; neither is part of
  this screen yet.

- **Tiles are `RowLink` cards** (#557's overlay): the whole tile navigates, and an inner link —
  the exposure line to `/auctions`, a coverage row to its area — is lifted with `ROW_LINK_ABOVE`.
  Sections skeleton independently in their final geometry (#151), through their own two queries
  under the `["overview", collectionId, …]` key — its own root, so no list mutation invalidates
  it; the figures refresh on the shared stale clock.
