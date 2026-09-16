# Overview

The **Overview** is the collection's front page — open it from **Overview** at the top of the
sidebar, or by navigating to the collection itself. It answers two questions on one screen:
**what is the collection worth** and **how far along is it**.

Every tile is a link. Clicking one takes you to the list screen that holds the underlying rows,
with the matching filter already applied — the Overview states sums, and the list screens stay
the place where the detail lives. A tile with nothing behind it yet says what would fill it.

## Choosing the areas

The value-over-time chart and **Coverage by area** break the collection down by area. Out of the
box that is the **top-level areas** — which says little if your tree starts with continents and
the countries you actually collect sit further down. **Choose areas**, at the top of the Overview,
opens the whole area tree: tick the areas you want to see, at any depth, and **Save**. The choice is
kept for the collection and is there again on your next visit. **Use top-level areas** clears it.

- **Each chosen area covers everything under it.** You may tick a country and one of its regions
  together: each gets its own line, and they overlap rather than being added up.
- **Other** holds the rest of the collection — everything under none of the areas you ticked — so
  nothing drops out of the breakdown. A stamp filed in two areas counts under every chosen area it
  is filed in, so the lines together can come to more than the collection's total; each copy is on
  at least one of them. Other is not a link: no list shows "everything else".
- The same choice applies to both the chart and the coverage tile, so the two never break down by
  different areas.

## Value

- **Holdings value** — the catalogue value of every copy you hold, against what you paid for it,
  with the surplus stated. Copies from an [opening balance](purchases.md#opening-balances) are
  costed at their **opening value**, named on its own — it is part of what the surplus is measured
  against, but never part of what you paid. Where auction results give a market value, it is shown as its own
  figure with its coverage (catalogue and market value answer different questions and are never
  added together). Opens the Copies list.
- **Capital on the market** — what your active offers are asking, and what your open auction bids
  would commit if they stand. Two figures, side by side: one is money you would receive, the
  other money you would pay. The asking line opens the active offers; the bidding line opens the
  auction watchlist.
- **Realized profit and loss** — net proceeds over every recorded sale (buyer handling,
  commission, your shipping and the frozen exchange rate all included) minus the sold copies'
  cost basis. It is every sale's own [profit and loss](sales.md#profit-and-loss) added up, so it
  counts the same copies the sale screens do: a sold copy with its cost pending, no cost recorded, no
  opening value, no exchange rate or a share that cannot be split is left out of both the proceeds
  and the cost, and counted on the tile. A copy from an opening balance counts against its opening
  value. Opens the [profit and loss screen](sales.md#the-profit-and-loss-screen),
  which shows where the figure comes from.
- **Purchase ROI** — how many purchase orders have already earned their cost back through sales,
  and how many are still outstanding. Opening balances are not purchases and are not counted: no
  money was spent on them to earn back. Opens the Purchases list.

Figures are stated in the collection's base currency. A row that cannot be counted — an unpriced
copy, an amount in a currency with no exchange rate, a cost still pending in an open lot — is
**counted apart and said so** on the tile, never silently dropped.

### Value over time

Below the Value tiles, a chart draws the **catalogue value of your holdings** and **what you paid
for them** — purchases only, never an opening value — on the same axes, one point per day — the space between the two lines is the surplus.
Move the pointer across the chart to read any day's figures: the value, the cost, the surplus, how
many copies were held and anything that could not be counted that day. Without the pointer, the
most recent day is shown.

- **Where the figures come from.** Stamporama records the collection's value once a day while it
  is running. A past day is shown exactly as it was recorded — later price or rate changes do not
  rewrite it.
- **Gaps.** A day the app was not running has no point, and the line breaks there instead of
  joining across the missing days.
- **Split by area.** Turn on *Split by area* to add one line per top-level area — or, once you have
  [chosen areas](#choosing-the-areas), per chosen area — each covering the area and everything under
  it. The area lines are not stacked and need not add up to the total: a stamp filed in two areas
  counts under both. Of the top-level areas, those that have never held any value are left out; a
  chosen area is always shown. Each area's name in the readout opens the Copies list filtered to it.
- **Where an area's history begins.** An area's value is recorded from the day it existed. If its
  history starts later than the chart does, a dotted line in its colour marks the first recorded
  day, and earlier days read *not recorded yet* rather than zero.
- **Other.** With areas chosen, the readout also states *Other* — the catalogue value of
  everything outside them **today**, with any copies it could not price counted beside it. It has
  no line: the daily record keeps each area's value, not "everything outside" a choice you can
  change at any time, so there is no past to draw.
- **Still collecting data.** A new collection — or one that has just started recording — shows a
  waiting note until two days are in.
- **A change of base currency.** Days recorded under a different base currency cannot share the
  axis with today's, so they are not drawn; the chart says how many were left out.

## Progress

- **Coverage by area** — checklist completeness rolled up per top-level collection area, or per
  [chosen area](#choosing-the-areas), **worst-covered first**, so the tile points at where the
  collection is thin. Each area opens the Issues list filtered to it. With areas chosen, an *Other*
  line gives the coverage of everything outside them. An area with no checklists reads *not
  tracked* rather than complete — coverage only means something where a checklist defines what "all
  of it" is.
- **Checklists** — how many checklists are complete, part-done and untouched, and which one is
  closest to done. Opens that checklist's issue.
- **Growth** — copies and issues added per month over the last year, derived from when they were
  recorded. Opens the Copies list, newest first.
- **Open wants** — open wants that nothing you hold satisfies yet, with their catalogue value as
  the size of the gap. A want whose satisfying copy is already ordered or in transit is counted
  as *on the way*. Opens the Want list.

The tiles show the collection as it stands right now; the value-over-time chart is the one place on
the screen that looks back.
