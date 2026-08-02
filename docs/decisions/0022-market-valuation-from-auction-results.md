# ADR-0022: Market Valuation from Recorded Auction Results

## Status

Accepted. Resolves the design question in #24; feeds bid recommendations (#25).

## Context

A catalogue price is published once a year and is a list price, not a transaction. What a stamp
actually fetches is visible in hammer prices, and ADR-0021 already puts those in the database as a
by-product of bidding: a closed `AuctionLot` carries `finalPrice`, the FX rate frozen at `endsAt`,
and a structured composition (`AuctionLotLine` = stamp × condition × certificate × format ×
quantity). ADR-0021 §4 makes the point explicitly — a lot added purely to watch what it fetches is
`observed`, and building the price base is a first-class reason to add one.

What was missing is the layer above: how those recorded results turn into "this stamp, in this
condition, is worth about X" — and how confident anyone should be in that X.

The governing constraint is **sample size**. This is a self-built base: a collector adds a handful
of lots a month, not a scraped corpus. Every decision below is shaped by wanting the thin evidence
to be usable and honestly labelled rather than pretending it is a market index.

The name is taken: `src/lib/valuation.ts` is *catalogue* valuation of copies (ADR-0007 §7). Market
valuation is a separate module, `src/lib/market-value.ts`, and the two are never conflated — one
answers "what does the catalogue say this is worth", the other "what did the market pay".

## Decisions

### 1. The unit of valuation is the full catalogue-price key, minus the edition axis

A market value hangs off **stamp × condition × certificate × format**, exactly the key
`StampCatalogPrice` uses (ADR-0006 §2, ADR-0020) and exactly the key `AuctionLotLine` records.
`formatId` null is the single, `certificateStatusId` null is "no certificate", both matched
exactly with no fall-back across levels — the same rule copy valuation already follows.

Catalogue prices additionally hang off a catalogue **edition**, and market value has no analogue:
a hammer price belongs to the date it was struck, not to a published book. Time is handled by §5,
not by an edition axis.

Folding any axis away would have bought sample size with a figure that means less. MNH against
Used is an order of magnitude; a Fotoattest is a real premium on the identical stamp; a block of
four is not four singles. Each of those is a different thing being priced, and averaging them
produces a number that describes nothing that was ever sold.

### 2. Every closed lot with a final price is a datapoint — at the hammer, not the buyer's total

The filter is `status = closed` **and** `finalPrice` present. The derived outcome (ADR-0021 §4) is
not consulted: `won`, `lost` and `observed` are all real prices the market paid, and dropping the
won ones to avoid a self-reinforcing loop would discard the results the collector knows best.
`open` and `cancelled` lots yield nothing, and neither does a closed lot whose final price was
never captured — an absent observation, not an error.

The figure is `finalPrice × fxRateToBase`, the rate frozen at `endsAt` (#354), so a 2023 result
keeps its 2023 rate. Revaluing an old hammer price at today's rate would make the datapoint state
something that was never true.

Buyer's premium and shipping are **excluded**. They are the seller's terms, not the stamp's worth:
the same lot at a 20%-premium house and at a marketplace charging nothing would produce two
different "values" for one item, which destroys the only property that makes datapoints
comparable. What a parcel cost is a purchase question and ADR-0009 answers it.

### 3. A mixed lot is split pro-rata by catalogue value

Most house lots contain more than one line and carry one hammer price. Each line gets

```
lineValue = finalPrice × (lineCatalogueValue ÷ Σ lineCatalogueValue)   then ÷ quantity
```

giving a per-unit figure for that line's key. Catalogue values come from the same headline
selection the lists already use — the area's primary catalogue name at its latest edition, format
factors per ADR-0020, unknown-variant umbrellas rolling up from the cheapest child (#238).

If **any** line in the lot has no catalogue value, the whole lot is skipped: a partial split would
silently hand the missing line's share to its neighbours. A single-line lot needs no catalogue
price at all — it is `finalPrice ÷ quantity`, full stop.

Splitting evenly was rejected because it prices the key rarity in a lot the same as the common
stamp beside it. Excluding mixed lots entirely was rejected because it discards most of a base
that is already small. The split is an estimate, so §5 down-weights it rather than hiding it: each
datapoint records whether it came whole from its lot or was derived from a split.

### 4. Every measure is computed; the median is the headline, and it shows from n = 1

A key's valuation is a small statistics block, not one number: **median, mean, min–max, n, latest
result date, span of the results, and how many datapoints were split**. Collectors read a thin
sample better than any single statistic summarizes it — five results of 8 · 11 · 12 · 14 · 40 tell
a story that "17" hides.

Where one figure is needed — collection totals, bid recommendations (#25), price suggestions
(#430) — it is the **median**, which is robust to the one wild result a thin philatelic sample
always contains and is reproducible by eye from the results list.

There is **no minimum sample and no time window**. A value appears as soon as one result exists,
and every result counts however old. On a self-built base a threshold or a rolling window would
throw away most of what has been recorded, and would do it invisibly. Both concerns are real, so
both are answered by §5 instead: thin and stale evidence scores low and says so, which is strictly
more informative than an absent value.

### 5. Confidence is a 0–100 score, and the badge is bucketed from it

```
sample    = min(n, 5) / 5
recency   = 1.0 if the latest result is ≤ 1 year old, 0.6 if ≤ 3 years, else 0.3
agreement = 1 − min(1, ((max − min) / median) / 2)      (0 when median is 0)
purity    = (wholeLotCount + 0.5 × splitCount) / n

score     = round(100 × (0.40·sample + 0.25·recency + 0.20·agreement + 0.15·purity))
badge     = low (< 40) | medium (40–69) | high (≥ 70)
```

Sample size is weighted heaviest because it is what this base is short of; agreement is weighted
lightest because a genuinely wide spread is often the truth about a stamp rather than a defect in
the evidence.

The score is only ever shown next to the facts that produced it (n, latest date, span, spread,
split count), so a surprising badge can always be traced to its inputs. It is a display and
ranking aid — no rule anywhere keys off the badge instead of off the figures.

### 6. Market value is shown against the catalogue price, as a realization ratio

Wherever a market value appears, the catalogue price for the same key appears beside it together
with `market ÷ catalogue` as a percentage — "12 EUR · 24% of Michel", compared in base currency.
That ratio is the number a collector actually reasons with, and the app already asks them to
supply it by hand elsewhere (#430 configures a percentage of catalogue value per platform/area/
condition).

A key with no datapoints shows **no market value**. No estimate is synthesized from comparable
keys' ratios: a fabricated figure that looks like the measured one beside it would be the one
mistake this feature cannot afford, and the option remains open as a later, explicitly-labelled
addition if coverage proves too thin.

### 7. Computed on demand, nothing stored

Valuations are aggregated from `auction_lot` / `auction_lot_line` at query time. No
`stamp_valuation` table, no queued recompute (ADR-0018), no invalidation edges — editing a lot's
final price changes the next screen that asks. The data is small (hundreds of closed lots, not
millions) and a list resolves its valuations in one grouped query per page. A materialized table
is a straightforward later optimization if a screen is ever measurably slow; it is not worth a
cache-staleness class of bug before then.

### 8. The stamp dialog's "Prices" tab becomes "Valuation"

The tab that today edits catalogue prices is where a collector already goes to ask what a stamp is
worth, so market value belongs there rather than on a screen of its own. The editable
edition × condition × certificate grid is untouched; a read-only **Market value** section sits
below it, one row per key with evidence, expandable to the lots the figures came from.

The market figures are not laid into the grid's cells: the grid's rows are catalogue editions and
market value has none (§1), so a market row would sit in the table pretending to be an edition.

Collection totals (#396) gain a market total alongside catalogue value and cost basis, counting
only copies whose key has evidence and reporting how many copies that is — a total over 12% of the
collection must not read as the collection's worth.

Auction lot screens are deliberately left out for now: valuing a lot's composition against its
current bid is the substance of #25, not a display detail here.

## Consequences

- Recording an `observed` lot has an explicit payoff, which makes the watchlist worth using on
  lots nobody intends to bid on.
- Catalogue price coverage becomes load-bearing for mixed lots (§3). Gaps do not corrupt anything,
  but they cost datapoints.
- Market values move as lots are edited, with no cached figure anywhere to reconcile.
- Every figure the app derives from market prices flows through one module and one headline
  statistic, so #25 and #430 inherit these decisions rather than re-deciding them.
