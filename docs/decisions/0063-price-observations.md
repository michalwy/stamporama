# ADR-0063: Price Observations from Other People's Auctions

## Status

Accepted. Written by #1633, which builds the observation and its place in market value. **Amends
ADR-0022** §2 (what a datapoint is) and ADR-0029 §2 (what the ratio is learned from); both read as
they did for the collector's own lots. Markets and the anchoring set per area are #1634 (§8 below);
the agent API that records observations in batches is #1635.

## Context

Market value (ADR-0022) is built only from the collector's own closed lots. Every lot is a fact of
the collector's own bidding — a sale, a seller, a parcel — and a lot added purely to watch what it
fetched is still one of those. That is a few results a month, and the bidding assistant's
`recommend_bid` often answers *unanchored*: the collector then types catalogue prices by hand until
it can answer.

Meanwhile auction aggregators such as Philasearch publish **realised prices** — hammer prices with a
catalogue number, a condition and a date, often hundreds for one field — and there was nowhere to
record one without inventing a lot, a sale and a seller for an auction nobody bid in.

Settled with the collector on 2026-10-04: an observation is a market fact, not the collector's
transaction; only exactly matched observations anchor; and a valuation says what it stands on.

## Decisions

### 1. An observation is a market fact, never a transaction

`PriceObservation` is a table of its own. It is never a lot, a sale or a purchase: it carries no bid,
no outcome, no parcel and no shipping, and none of the auction or purchase reads touches it. That is
the whole of how it stays off the watchlist, out of exposure and out of purchase history — nothing has
to filter it out.

It belongs to one stamp and goes with it (`ON DELETE CASCADE`); a lot line, part of a bidding record
that outlives the catalogue, is `Restrict` instead. The vocabulary and the two contacts are
`Restrict`, as on a lot line.

### 2. What an observation holds

- **The stamp** — an unknown-variant umbrella when the listing does not establish the variant.
- **Condition, certificate and format**, where known. A null condition is *not established*; a null
  certificate is *none* (ADR-0006 §2), so a doubt about the certificate is a flag of its own,
  `certificateUncertain`. A null format is the single, as everywhere.
- **The price as observed**: its amount and currency, whether it is the **hammer** or **all-in**, and
  the buyer's premium (percentage and per-lot fee) it was subject to.
- **The day of the sale**, and the rate of that day (§4).
- **The source**: the platform (a contact, required), the auction house (a contact, optional — an
  Allegro seller is not a house), the auction, the lot number and the address.

### 3. Exact or a hint — and the doubt is read, not typed twice

An observation is **exact** when the variant, the condition and the certificate are all established.
Two of the three doubts are read live off the record: the variant is not established when the stamp
is an unknown-variant umbrella (`isUnknownVariantStamp`, #238), the condition when `conditionId` is
null. Only the certificate needs its flag. Reading them live means a stamp that grows variants after
an observation was recorded turns it into a hint without anything being rewritten, and the agent API
(#1635) recording a number that resolves only to an umbrella gets a hint without having to say so.

**Only an exact observation counts.** An uncertain one is listed as a hint and never enters a figure
— not the median, not the sample, not the confidence, not the ratio.

### 4. Hammer in the base currency, at the rate of the sale's day

Market value stays on hammer prices (ADR-0022 §2). A hammer observation is itself; an all-in one is
reduced by its premium — `(allIn − fee) ÷ (1 + percent/100)`, to the nearest cent, the inversion a bid
typed into an all-in cell already goes through (`bidCosting`). With no premium (Allegro) the two are
the same figure. Both figures are shown, so a reader checking a median can redo the arithmetic.

**The rate is the ECB reference rate of the sale's day**, the last published on or before it, fetched
from the ECB's data API at the write and frozen on the row (`fetchEcbRateOn`). The collection's own
rate table holds today's snapshot only (#20), which is right for a lot recorded as it closes and wrong
for a 2021 result read in 2026 — ADR-0022 §2's argument for a lot's frozen rate, applied to a day the
collector did not live through. Decided with the collector over *today's rate at the write* and *a
rate typed by hand*.

Best-effort, as a lot's rate is: a lookup that fails stores none, the observation is kept, and a
foreign-currency observation with no rate does not count (it is listed as a hint saying so). An edit
reads the rate again when the day or the currency changed, or when it is still missing.

### 5. The premium is proposed from the house, then owned by the observation

Picking a house that has terms proposes its `buyerPremiumPercent`, `buyerPremiumFixed` and
`defaultCurrency` into the fields still empty. They are **copied** onto the observation, exactly as a
sale's terms are seeded from its seller (#308/#319): a house changing its terms later re-prices
nothing already recorded.

### 6. Exact observations join market value beside the collector's own lots

An exact observation is one **whole** datapoint (never split — it is one stamp at one key) at its key
`stamp × condition × certificate × format`, dated by its sale, of the same standing as a lot line's
(`MarketDatapoint.source` says which). So it moves the median, `n`, the span and the confidence like
any result, and its key's catalogue value is resolved by the same `valuateItemRows` pass. Everything
downstream of `readStampMarketValues` — the holdings total, a checklist's set totals, the bid anchors —
inherits it without a change of its own.

The Valuation dialog lists the observations under the Market value grid: the counted ones with their
source, day, price as observed and as counted, then **Hints — not counted** saying why. A cell's
expansion lists the observations behind its median beside the lots. The collector records, corrects
and deletes observations there — the one place in that read-only window where something is written,
as the carrier value's *Save* already is (#747): it is where the question is asked.

### 7. Exact observations teach the realization ratio too

ADR-0029 §2 learns the ratio from every datapoint with a catalogue value. Decided with the collector:
exact observations are datapoints there as well, so a field read off Philasearch teaches the ladder
behind Estimated value and the bid recommendation. The bucket's drill-down names them beside the
lots.

### 8. Markets are #1634's

Every observation will have a **market** — the country it was sold in — and each area will say which
markets anchor its valuations. Decided with the collector: none of that is here. #1634 gives contacts
a market and derives an observation's from its house or platform (and a lot's from its sale's
seller), so there is no copy on the observation to drift from the contact. **Decided in
[ADR-0064](0064-markets-and-anchoring.md).**

## Consequences

- A realised price can be recorded without inventing a lot, and the lots screen's recommendations and
  the Valuation dialog's figures move with it.
- A foreign-currency write makes one request to the ECB's data API; a batch of hundreds (#1635) will
  want those grouped by day.
- An observation and a lot of the collector's describing the same sale would both count. Recording
  someone else's result is what an observation is for, and a lot is what the collector's own bidding
  produces; the two are not reconciled.
