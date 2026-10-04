# ADR-0064: Markets on Auction Results, and the Markets That Anchor Each Area

## Status

Accepted. Written by #1634. **Amends ADR-0022** (§2: a datapoint now also has a market, and only one
from an anchoring market enters a figure), **ADR-0029** §2 (the ratio is learned only from those), and
**closes ADR-0063 §8**, which left markets to this decision.

## Context

Prices differ between markets. A foreign result is good evidence for German material — the Reich,
Danzig, the occupations, the plebiscites — and only a hint for Polish material. Until now market value
counted every result alike, so a valuation resting on one sale in Spain looked the same as one resting
on five Polish sales, and #1633 was about to bring in hundreds of results from Philasearch, most of
them sold in Germany.

Settled with the collector on 2026-10-04: every result has a market; each area states which markets
anchor its valuations, inherited down the area tree; results from other markets are shown as hints;
and a valuation says what it stands on. Rejected: weights per market, and a plain domestic/foreign
split.

## Decisions

### 1. A market is a country, and it lives on the contact

A market is an ISO 3166-1 alpha-2 code. `Contact.market` holds it, for a contact that sells — a
platform, a seller or an auction house. **A result never stores one.** An observation takes its
house's market, else its platform's; one of the collector's own lots takes its sale's seller's, else
the sale's platform's (`resultMarket`). So setting a contact's market reaches every result already
recorded, and nothing on a result can drift from the contact it came from — the reason ADR-0063 §8
kept the column off the observation.

### 2. A result with no market counts as the home market

`Collection.homeMarket` (default `PL`, set in Settings → Collection) is what a result counts as when
its contacts name no market. Decided with the collector over *anchors everywhere* and *always a hint*:
no contact has a market when this lands, and either alternative would have changed every existing
valuation the moment it did. The evidence still says *not known* rather than inventing a country.

### 3. Each area states its anchoring markets; the whole list inherits

`CollectionArea.anchorMarkets` is a list of codes. Empty means the area says nothing and the question
passes to its parent; the **whole list** inherits from the nearest area that names any, exactly as the
price sources do (#675), so `DE, AT` on Germany states Danzig's anchors completely. A tree that names
none anchors on the home market. A stamp is judged by the area it is valued in — its primary area,
else its first — so the result and the catalogue figure it is compared with come from the same place.

The form's update leaves the list alone when a caller does not mention it (unlike the fields beside
it), so a caller restating an area for another reason — `move_area` — cannot clear it by not knowing.

### 4. Only anchoring-market results enter a figure

`partitionByAnchoring` splits datapoints by their **own** stamp's anchors after extraction, so a mixed
lot is split over all its lines as before and each line's share then counts or not by its own area.
The rest are **hints**: never in the median, the sample, the span, the confidence, the totals
(`readMarketMedians` is a projection of the same read), the estimated value or the realization ratio
(ADR-0029 §2) — the ratio learner judges each datapoint by the stamp it is about. A key with only hints
has no market value, and the bid anchor falls through to catalogue × ratio as for any key with none.

### 5. A valuation says what it stands on

Every market figure carries its results counted by market (`markets`) and the other markets' results
at its key (`hintMarkets`). The Valuation dialog shows both in a figure's hover, tags each result with
its market, lists the collector's own lots from other markets under the grid, gives an observation from
another market the hint reason *other-market*, and names the markets the stamp's area counts. The lots
screen's evidence popover (#511) prints the counts beside a market anchor and *not counted, other
markets* under any line with hints. `recommend_bid` lists the results a market anchor used
(`marketResults`: source, market, amount, day) and counts the ones left out (`notCounted`).

### 6. Nothing is stored

Market value stays computed on demand (ADR-0022 §7). Changing a contact's market, an area's anchors
or the home market re-judges every result on the next read; daily snapshots (ADR-0053) keep what the
reads said that day.

## Consequences

- Foreign results can be recorded in bulk (#1635) without moving Polish valuations, and German
  material can be valued on them by setting its area's anchors once.
- Until contacts are given markets, everything counts as before; the first valuation to change is the
  one whose contact the collector gives a foreign market.
- A contact that sells on several markets has one market. A platform aggregating many houses
  (Philasearch) is answered by the house, which an observation names.
