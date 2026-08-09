# ADR-0029: Bid Recommendations for Auction Lots

## Status

Accepted. Resolves the design question in #25. Builds directly on ADR-0021 (auction tracking) and
ADR-0022 (market valuation); it decides nothing those two already decided.

## Context

ADR-0021 gave a lot a **ceiling** — `AuctionLot.maxBid`, an *all-in* valuation of what the lot is
worth to the collector — and everything that hangs off it: `allIn`, `maxBidWithin` (the hammer price
whose all-in still fits inside the ceiling), `headroom`, the `bid-possible` and `over-ceiling`
signals, and the two-sided ceiling cell on the lots screen. #370 added a quick fill that copies the
lot's catalogue value into that ceiling unchanged.

So the field, the arithmetic and the place to put a figure all exist. What #25 is actually about is
narrower than its original framing: **what number should be proposed there**, now that ADR-0022
turns recorded hammer prices into a median market value per `stamp × condition × certificate ×
format`.

The governing constraint is the same one ADR-0022 names — this is a self-built price base of tens of
results, not a market index — plus a second one specific to this side of the workflow: a
recommendation is read in the ninety seconds before a lot closes. It has to be one glance, it has to
be traceable to its inputs, and it must never look more certain than it is.

## Decisions

### 1. Each line is anchored on its own: market median first, catalogue × a learned ratio second

The anchor is resolved **per `AuctionLotLine`**, not per lot:

```
anchor(line) = marketMedian(line.key)                    when the key has any datapoint
             | catalogueValue(line) × realizationRatio   when the catalogue value exists (§2)
             | none
```

`marketMedian` is ADR-0022's headline statistic for the line's exact key, and `catalogueValue` is
the same figure the composition rollup already computes (unknown-variant umbrellas rolling up from
the cheapest child per #238, format factors per ADR-0020).

Per line rather than per lot because a single lot routinely mixes a well-recorded key with one that
has never been seen: a lot-level "use market if we have enough of it" switch would throw away
measured evidence for the lines that have it, or extend it to lines that do not.

Market first because it is a transaction and the catalogue is a list price — the whole argument of
ADR-0022. There is no blending of the two and no confidence-weighted crossfade: a figure that is
part-measured and part-policy cannot be explained when it looks wrong, and the point of the evidence
popover (§8) is that every number on it can be traced.

A line with neither a market datapoint nor a catalogue value is **unanchored**. It is counted and
reported, never treated as zero — exactly as `summarizeLotComposition` already reports
`unpricedLines`. `fair` is the sum over the anchored lines and is **null when none are anchored**;
a lot whose composition is entered but unpriceable is unanswered, not worthless.

### 2. The catalogue ratio is learned from recorded results, not configured

What fraction of catalogue a stamp actually fetches is not one number. It moves with the area, with
the period, and with the condition — a 1940s Polish issue and a modern Western European one realize
nothing like the same share of their Michel figure. A single configured percentage would be a market
opinion stated once and wrong nearly everywhere, which is exactly what a base of recorded hammer
prices exists to replace.

Every market datapoint already carries both halves of the ratio: ADR-0022 gives a per-unit market
value for a key, and that key has a catalogue value. So

```
ratio(datapoint) = perUnitMarketValue ÷ catalogueValue(key)      both in base currency
```

A datapoint whose key has no catalogue value yields a market value but no ratio.

**The ladder.** For a line being anchored, the ratio is the **median** of the ratios in the most
specific bucket that holds at least `MIN_RATIO_SAMPLE = 3` of them; otherwise the next one down:

| # | Bucket | Matched on |
|---|--------|-----------|
| 1 | area × condition × period | the stamp's primary area, the line's condition, `issuedYear` within **±2 years** |
| 2 | area × condition | primary area and condition |
| 3 | area | primary area |
| 4 | collection | every ratio recorded |
| 5 | `bidFallbackPercent` | nothing recorded at all |

Condition drops out before area deliberately, which reverses what one might expect. The catalogue
*already* prices condition — an MNH and a used figure for the same stamp are different catalogue
entries — so the ratio between market and catalogue is comparatively stable across conditions. What
the catalogue does **not** carry is that a whole area's figures run high or low, and that is the
effect worth keeping longest.

**Period is a sliding ±2-year window, not a decade bucket**, so 1949 and 1950 are neighbours rather
than falling either side of a boundary. The window is centred on the stamp being anchored, so each
line resolves its own sample — the evidence popover states which bucket was used and at what `n`,
which is what keeps two adjacent stamps showing different ratios explainable.

A stamp with no `issuedYear` and a stamp with no primary area simply skip the buckets that need
them.

**A split lot counts once per bucket.** ADR-0022 §3 splits a mixed lot's hammer price pro-rata by
catalogue value, which means every line of that lot has, *by construction*, the same market ÷
catalogue ratio — the lot's. Counting them separately would let one twenty-line dealer lot enter
twenty identical ratios and dominate the median. Within a bucket, split-derived ratios are therefore
deduplicated by lot, and a lot spanning several buckets contributes one observation to each. Whole
(single-line) datapoints count individually, as they are independent observations.

**Why a minimum sample here, when ADR-0022 §4 refused one.** The two are not the same trade. There,
the alternative to a thin sample is showing nothing; here it is a broader bucket, which is strictly
better than one accidental ratio driving every unrecorded stamp of a decade. Three is the point at
which a median stops being a single observation wearing a statistic's name.

**Median, not mean**, for the reason ADR-0022 §4 already gives: a philatelic sample always contains
one wild result, and the median is reproducible by eye from the list beneath it.

Both constants — the minimum sample and the ±2-year window — are code, not settings. They are
properties of how thin this evidence is, not preferences, and a collector asked to tune them would
have no way to tell a better value from a worse one.

### 3. The recommendation is three figures: floor, fair, walk-away

```
fair     = Σ anchor(line) × line.quantity
floor    = fair × bidFloorPercent   / 100
walkAway = fair × bidCeilingPercent / 100
```

One number would state a precision this evidence does not have. Three state a decision: below the
floor the lot is a bargain, around fair it is priced, past the walk-away it belongs to somebody
else. That is how the figure is used — a lot is not "worth 42.17", it is worth bidding on up to a
point.

### 4. The band is a stated percentage of fair, not the market's own spread

Deriving floor and walk-away from each line's cheapest and dearest recorded result was rejected on
the sample size. At `n = 1` — the common case on this base — min = max = median and the band
collapses to a single number that *looks* like a measured range; at `n = 2` it is two points of
noise rendered as a market opinion.

Widening the band by ADR-0022's confidence score was rejected for a different reason: the width
would then move for reasons the collector cannot read off the screen, and a band that is ±15% on one
lot and ±40% on the next teaches nothing. Confidence is still shown (§8); it just does not silently
rescale the arithmetic.

The band is where a collector's own trading style belongs — how much under the market they insist on
buying — which is a preference, unlike the realization ratio, which is a measurement.

### 5. All three figures are all-in, in the sale's currency, and each shows the bid to type

A ceiling is an all-in valuation (ADR-0021 §6), so a recommendation for it is too. Every figure is
therefore shown twice, exactly as the ceiling cell already is: the all-in valuation, and the hammer
price that fits inside it via `maxBidWithin` — which is what a bid box actually takes. Shipping is
excluded from the per-lot fees, as everywhere a single lot is costed.

Currency: catalogue values already roll up in the **sale's** currency, market medians and ratios are
computed in the **base** currency (ADR-0022 §2 freezes each datapoint's rate at its own `endsAt`).
Ratios are unitless, so they apply to the sale-currency catalogue value directly; market anchors are
converted base → sale at the current rate, because the recommendation is about a bid being placed
now. A line whose anchor cannot be converted is reported as unconvertible and not counted, mirroring
`LotLineValue.unconvertible` — it exists and cannot be summed, which is a different fact from having
no price.

### 6. A lot is worth the sum of its lines

No series premium for a complete run, no bulk discount for a large lot. Both are real market effects
and both are domain assumptions this project has not been asked to make: a series premium would
require the catalogue model to know what a complete series is, and a bulk discount would bake a
market opinion into a stored setting.

Where a collector believes multi-line lots go cheap, the floor percentage is where they say so, and
the ceiling cell stays editable in any case.

### 7. Ownership is shown, never computed with

The evidence says *"you already hold 2 of the 3 stamps in this lot"*, using the inventory the app
already has (ADR-0007). It does not move the figures.

An automatic duplicate discount was rejected because it is wrong precisely where this app is
strongest: duplicates are bought deliberately for trade and resale, so a system-applied haircut
would systematically under-bid the material a collector most wants. A stored per-lot want level was
rejected as a field to fill on every lot whose only effect is to rescale a number the collector can
simply type.

Urgency is a judgement. The recommendation's job is to put the facts next to it.

### 8. A column of its own, one quick fill for `fair`, and an evidence popover behind the figure

`fair` is a **column in the lots grid's *worth* section**, beside catalogue value and against the
same two row labels — `value` and `headroom`. The two are different answers to *what is this worth*
and belong side by side: catalogue headroom says whether the lot is going under the book, and
recommended headroom whether it is still inside what the recorded evidence says to pay.

The ceiling cell also gains a third quick fill beside the existing catalogue one (#370) and the
cross-column one — `REC`, which writes `fair`. Both catalogue and recommendation fills stay: "what
the catalogue says" and "what it is worth bidding" are different statements, and the first is still
the honest one when a lot has no evidence behind it.

The recommendation cell **is** the trigger for the evidence popover, exactly as the catalogue cell
is the way in to the composition editor. The way in has to be a figure that is already on screen: a
disclosure revealed on hover is one most collectors never find, and this evidence is the whole
argument for trusting the number.

The popover holds floor and walk-away with their bid conversions, one row per line showing which
anchor it used, the median with `n` / latest date / span and the ADR-0022 confidence badge for
market-anchored lines, **the ratio bucket, its percentage and its `n`** for catalogue-anchored ones,
the ownership counts, and the unanchored and unconvertible line counts.

Naming the bucket is what makes a learned ratio trustworthy rather than magic: *"55% — Polska
Ludowa, MNH, 1945–1949, n = 6"* can be argued with; *"55%"* cannot.

**All three levels can be taken, and each is taken where its evidence is.** Every level in the
popover is clickable and writes itself into the ceiling; all three are also in the row's `⋮` menu,
for the collector who already knows which one they want. What the row itself offers is `fair` alone.
The original decision here was one fill and no way to take the other two at all, on the argument
that a floor-or-fair-or-walk-away judgement does not belong in a row that is scanned. That argument
holds for the *row* and is why `REC` is still only `fair` — but it was wrong to conclude that the
judgement should therefore be unavailable. It is exactly the decision this feature exists to
support; it just belongs on a surface that is read rather than scanned, which the popover is.

Three quick fills stacked in the row's gutter stay rejected, on the original argument. A section in
the lot dialog was rejected because bidding happens on the list.

### 9. Three collection settings, and the ratio is not one of them

```
bidFloorPercent    Int @default(75)
bidCeilingPercent  Int @default(125)
bidFallbackPercent Int @default(100)   // only when the collection has no ratio evidence at all
```

The band is a preference and is configured. The realization ratio is a measurement and is not:
allowing it to be overridden would reintroduce the stated market opinion §2 exists to remove, and
the collector would be tuning against evidence the app is showing them on the same screen.

`bidFallbackPercent` is the cold start only — a collection with zero recorded results. It defaults to
**100** so that, until anything has been learned, a catalogue-anchored fair figure is exactly what
#370's catalogue quick fill already writes and nothing silently changes meaning. It stops being
consulted the moment bucket 4 has three ratios in it.

### 10. Computed on demand, in a pure module, stored nowhere

`src/lib/bid-recommendation.ts` — no Prisma, unit-tested, alongside `auction-lot.ts`. The domain
layer resolves each line's market median, catalogue value, realization ratio, conversion and
ownership count and hands them in; the module does arithmetic and bookkeeping only.

Nothing is stored — not the recommendation, and not the learned ratios. A stored ratio table would
need invalidating on every lot edit, every catalogue price change and every area reassignment, and
the figures move slowly enough that recomputing them per page costs less than one class of
staleness bug. This mirrors ADR-0022 §7 and inherits its performance argument: hundreds of closed
lots, one grouped query per page. A materialized ratio table is a straightforward later optimization
if a screen is ever measurably slow.

## Consequences

- #25 depends on #455/#456 shipping first. Without recorded market values there are no ratios
  either, so every line falls back to `bidFallbackPercent` and the feature is #370 with extra
  ceremony.
- The price base now feeds bidding **twice**: directly, for keys that have been seen, and
  indirectly, as a realization ratio for everything else in the same area and period. Recording an
  `observed` lot pays off far beyond the stamps it contains — which is the strongest argument yet
  for the watchlist ADR-0021 built.
- Catalogue price coverage stays load-bearing (ADR-0022 §3 already made it so for mixed lots), and
  is now load-bearing twice over: a key with no catalogue value contributes no ratio.
- Recommendations move as results accumulate, with no cached figure anywhere to reconcile. A
  collector will see the same lot recommended differently a month apart, and the popover has to make
  that legible rather than surprising.
- The app ships with no market opinion of its own: the band is the collector's, and the ratio is the
  evidence's.

## Child issues

- #508 — bid recommendation settings on the collection
- #520 — learned realization ratio from recorded results
- #509 — bid recommendation arithmetic (pure module)
- #510 — resolve lot line anchors from market value, catalogue and inventory
- #511 — recommendation quick fill and evidence popover on the lots screen
