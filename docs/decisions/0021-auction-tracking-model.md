# ADR-0021: Auction Tracking as a Bidding Watchlist

## Status

Accepted. Resolves the design question in #23; schema and arithmetic in #350.

## Context

Auction tracking was originally framed as a **register of market auction results** — a table of
what things sold for, fed from external sources, to be mined for valuation (#24) and bid
recommendations (#25).

That framing does not match the workflow the feature exists to serve. What the collector actually
does is bid: browse a house catalogue or a marketplace, note the interesting lots, watch the price
climb, decide a ceiling, and find out afterwards whether the lot was won or lost. The market data
is a *by-product* of that — a lost lot's final price is the price signal — not a separate corpus
somebody has to go and populate.

Much of the original scope has also been absorbed by work landed since. `Purchase`/`PurchaseLot`
(ADR-0009) covers acquisition with its platform, currency and frozen FX rate. `Offer.inActiveBidding`
(#215) covers auctions where we *sell*. `ExchangeRate` (#20) and `StampCatalogPrice` (ADR-0006)
cover currency conversion and catalogue value. What was missing was only the part before the
purchase exists: the watchlist, and the fork at its end.

## Decisions

### 1. The parent entity is a settlement with one seller, not an auction event

`AuctionSale` is **what ships in one parcel from one seller**. For an auction house that coincides
with the house's own sale (`Köhler 385`); on a marketplace it is an open-ended basket of everything
currently being bid on with one seller. Winning something else from that seller after the parcel
has shipped closes one sale and starts another.

Modelling the event instead — "Köhler 385" as a thing in the world, with the collector's lots
hanging off it — would have been the obvious choice and is the wrong one, because the interesting
question is never "what was in that sale?" but "what is this parcel going to cost me?".

The payoff is that **shipping distribution falls out of ADR-0009 §3 for free**. Shared cost has to
be spread over a group, and choosing the group is the hard part of any settlement flow. Here the
grouping is made at bidding time, when it is natural and cheap — the collector already knows which
seller a lot is with — so settlement never has to ask "which purchase does this go into?". Had the
parent been the event, a marketplace basket would have had no parent at all and shipping would have
needed a mechanism of its own.

### 2. Seller and platform are two separate contacts

`sellerId` is who is being bought from; `platformId` is what the sale is routed through. A house
selling directly is the same `Contact` in both fields; a house listing through philasearch is
seller = house, platform = philasearch. This mirrors `Purchase.contactId` / `Purchase.platformId`
exactly (ADR-0009 §1), down to the `onDelete: Restrict` detach-before-delete guard from ADR-0008 §4.

Collapsing the two would make an aggregator indistinguishable from the houses behind it, and the
distinction is not cosmetic: the seller decides the terms, the platform decides how one gets there.

### 3. Currency and fee defaults live on the seller and are seeded onto the sale

`Contact` gains `defaultCurrency`, `defaultShippingCost`, `buyerPremiumPercent` and
`buyerPremiumFixed`, all optional. They are **copied onto the `AuctionSale` at creation** and freely
edited there afterwards — never read live.

This is the same decision already made twice: listing templates and photo configuration seed from a
platform onto an offer (#308), and the description format seeds the same way (#319, ADR-0019). The
reasoning does not change with the entity. A seller who raises their premium next season must not
silently re-price a parcel already being tracked, and must certainly not re-price one already
settled into a purchase — the amounts there are what was actually paid.

Currency belongs to the **seller**, so `platformCurrency` (#196) does not decide it. That column
exists because a marketplace really does fix one currency for everything transacted on it, which is
what guarantees offer↔sale consistency. An auction aggregator does the opposite: philasearch carries
houses listing in EUR, CHF and GBP side by side, so a platform-level currency would be wrong for
most of what passes through it.

It is, however, the **second** answer rather than no answer. A new sale's currency is seeded in
order: the seller's `defaultCurrency`, then the platform's `platformCurrency`, then the collection's
base currency. The seller still overrules the platform in every case where they have said anything,
so the aggregator argument above is untouched — but the add-lot dialog creates sellers as it creates
lots, and a seller met for the first time has no default at all. Falling straight to a hard-coded
`EUR` there landed lots bid on a zloty-only marketplace in a EUR parcel. The dialog **shows** the
seeded currency and lets it be changed before the sale is created, because every amount on the lot
is entered in it.

### 4. Outcome lives on the lot, never on the sale — and is **derived**, never recorded

`AuctionLot.status` is the lot's **lifecycle**: `open | closed | cancelled`. The sale's own `status`
(`open | settled | closed`) is about the parcel, not about how the bidding went. Within one
settlement some lots are won and others lost, and that is the ordinary case rather than an edge one —
it is what bidding *is*. A sale-level outcome would have no meaning to record.

How the bidding went is **computed** from the money and never stored (`lotOutcome`,
`src/lib/auction-lot.ts`):

| lifecycle | figures | outcome |
| --- | --- | --- |
| `open` | — | **pending** |
| `cancelled` | — | **cancelled** |
| `closed` | no `myBid` | **observed** |
| `closed` | `finalPrice < myBid` | **won** |
| `closed` | `finalPrice > myBid` | **lost** |
| `closed` | `finalPrice = myBid` | `wonTie` decides |
| `closed` | `myBid`, no `finalPrice` | **lost** — pre-existing rows only |

The status used to be `watching | won | lost | cancelled`, hand-set from the row's menu. Three things
were wrong with that, and the third is what forced the change.

**Won and lost are not facts.** They follow from `myBid` against `finalPrice`, and `bidStanding`
already computed exactly that arithmetic for the live case. Recording a conclusion by hand meant a
lot could sit filed `won` while its own figures said it was outbid, with nothing to catch it — the
class of bug a derived value cannot have.

**`closed` says something the old vocabulary could not.** A lot sitting `watching` past its `endsAt`
was standing in for "ended, not yet looked at", which is a real and common state with real work
attached. It is now the plain reading of `open` after the close, and the `won-pending` signal is
literally that list.

**Watching a lot without bidding on it had nowhere to go.** Adding lots purely to record what they
fetch is a first-class use of this feature — it is how the price base for #24 gets built, and it
costs nothing beyond the composition that was going to be entered anyway. Such a lot is not `lost`
(there was no defeat) and not `cancelled` (the auction ended and its price is real). Under the
derived rule it needs no new vocabulary at all: **no bid recorded is exactly what makes it
`observed`**, which is the strongest evidence the split was the right cut.

The tie is the sole exception, and it is why `wonTie Boolean?` exists. At `finalPrice = myBid` the
two real cases — you bid your maximum first and won, or someone else bid the same maximum first and
you lost — carry identical figures, and only the order of the bids separates them. That order is a
fact no column holds, so it is asked once at closing and stored. This does not walk the decision
back: the principle is *record facts, derive conclusions*, and bid order is a fact. `wonTie` is
consulted only at a tie, cleared whenever the figures stop tying, and null-on-a-tie reads as `lost` —
guessing a win would feed a fabricated line into settlement (§7).

Filtering is by outcome, never by lifecycle: `open | closed | cancelled` is bookkeeping, while what
the collector looks for is "what did I win", "what did I only watch". The predicates in
`outcomeWhere` restate `lotOutcome` in SQL — accepted duplication, because every figure the rule
reads sits on the row, so the alternative is loading the whole table to bucket it. Unit tests pin the
arithmetic and integration tests pin the predicates against it.

### 5. The bid is a single overwritten figure with `checkedAt`, not a history

`currentBid` is overwritten in place and `checkedAt` records when it was read. There is no bid
history table.

Refreshing is manual — see §8 — so every field that must be kept current is real work done by a
person. A history bought with that work would answer questions nobody asks; the one question that
does get asked before a lot closes is "how stale is this?", and `checkedAt` answers it in one
column. `finalPrice` is separately optional, because a lot nobody bid on yields no result to record:
that is an absent observation, not an error state to be filled in.

What that optionality **stopped** covering under §4 is "I bid, and never saw how it ended". With the
outcome derived, a bid and no result cannot be read at all, so closing refuses it. The honest answers
are to leave the lot `open` until the result is known, or — if the bid was never really placed — to
clear it, which files the lot as `observed`. Nothing is ever inferred from the last observed bid:
that figure is a lower bound on the result, and promoting it would poison the very data #24 consumes.
Rows written before §4 can still hold that shape and read as `lost`, which is what they always meant.

### 6. Composition is structured, and reuses the pricing machinery that exists

`AuctionLotLine` is `stamp × condition × certificate × format × quantity` — the shape a
`StampCatalogPrice` is keyed on. Not free text.

Free text would be quicker to enter and would make the whole feature useless: a lot's catalogue
value could not be computed before it closes, and a lost lot could not be attached to anything
afterwards. Structure is what turns the watchlist into an input for #24.

Two things are deliberately **reused rather than re-decided**. A line pointed at an unknown-variant
umbrella covers "variant not identified yet" — the everyday state of material one is bidding on —
and its value rolls up from the cheapest variant child exactly as the issue list does (#238). And
`formatId` prices multiples through `StampFormatFactor` (ADR-0020), with null meaning single. A
lot's catalogue value is therefore a sum over its lines using machinery already in place; there is
no auction pricing engine.

The arithmetic that *is* new is small and pure (`src/lib/auction-lot.ts`, no Prisma, unit-tested,
mirroring `offer-summary.ts`):

```
allIn(bid) = bid + bid × premiumPercent / 100 + premiumFixed + shippingCost
headroom   = catalogueValue − allIn(bid)
```

The all-in figure, not the hammer price, is what a ceiling has to be set against. Comparing
catalogue value to the hammer price alone systematically overpays on cheap lots, where shipping and
a fixed lot fee are a large share of what leaves the bank account. Shipping belongs to the parcel,
so the sale-level rollup adds it **once** however many lots are in the sale — which is only
expressible because of §1.

Four things settled when this was built (#353), all of them consequences of the reuse rather than
new policy:

- **The valuation is the copy valuation.** `valuateItemRows` (`items.ts`) values a
  `stamp × condition × certificate × format` row, of which a physical copy is one instance and a lot
  line is another at a null certificate — a lot is described before it is owned, so there is no
  certificate to match on. Re-deriving the rollup and the factor resolution in the auction module
  would have been two copies of #238 and ADR-0020 to keep in step. It is called **once per page of
  lots** (`auction-lines.ts`), so the factor table and the area tree load once, not per row.
- **Currency pivots through the base currency into the sale's.** Catalogue prices are valued into
  the collection's base currency like everywhere else, then converted once per sale currency into
  the sale's — because the bid, the premium and the ceiling are all denominated there, and a
  headroom figure mixing two currencies would be arithmetic on nothing. A missing base → sale rate
  makes a line **unconvertible**, which is deliberately not the same state as *unpriced*: it has a
  value and cannot be counted, and reporting it as unpriced would send the collector off to enter a
  figure that already exists.
- **No value is not zero.** A lot whose composition is entered but unpriced reports `null`, not
  `0.00`. A zero would make every headroom against it read as a catastrophic overbid. Unpriced and
  unconvertible lines are counted and surfaced beside the total, for the same reason the sale
  summary reports its unvalued lots: a total that silently omits half the lot looks complete.
- **A lot row's headroom excludes shipping; the parcel's includes it.** The same split `allIn`
  already makes on the row (#351). Charging shipping per row would double it the moment two lots are
  open with one seller, and the sale's own total is where it is added once.

The **certificate** was added in #353, after the first cut valued every line at "no certificate" on
the reasoning that a lot is described before it is owned. That reasoning was wrong for exactly the
material this feature exists for: a house lot is routinely sold *with* a Fotoattest, and the
certificate is a large part of why it fetches what it does. Nullable, null = none, the same unmarked
default `Item` uses. Matching stays **strict** — a line naming an Attest is unpriced until a price
exists at that level — because the alternative is quietly valuing a certified lot at the plain
figure, which is the error the column was added to prevent.

Composition is **entered with the lot**, not only after it: `createAuctionLot` takes the lines and
writes both in one nested create, every line validated before anything is written. Capturing a
listing and saying what is in it is one act — the collector is reading the description as they
type — and a flow that saves an empty lot and asks them to go find it again is the flow that leaves
compositions unentered. Adding a line is likewise the intake's own **two-step flow**: the
picker opens on the click that asked for a line, and condition / certificate / format / quantity
follow in a second dialog once something has been picked. Two questions of two different sources —
the catalogue tree answers what it is, the listing text answers what state it is in — and putting
both on one screen means asking about the condition of nothing in particular. What can be picked is a stamp **or a whole issue**, the purchase intake's own
picker: a house lot is routinely "Michel 1–12, complete", and twelve trips through a picker is the
reason such a lot would go undescribed. The series is an entry shortcut that expands into one line
per member marked required for completeness — a stored line is always one stamp, because catalogue
value is summed per stamp and a lost lot has to be attributable per stamp.

A composition also **names the lot**. `AuctionLot.title` is what the listing called it, and a lot
captured in a hurry has none; rather than "Untitled lot", the name is derived from what the lot
holds — catalogue numbers under their own prefix, collapsed into spans, and the shared issue. Deliberately **not** stored, which is the
opposite of the offer-title rule (#209/#365): an offer title is *published*, so it must be stable and
editable, while a lot name is read on our own screens only and a lot is described line by line, so a
stored value would freeze on the first stamp entered.

Composition is edited on **two surfaces**, which is the same split §9 already made between the
watchlist and the sale. On a sale's own screen every lot is a collapsible **card over its lines** —
the purchase-order intake and offer-detail layout, down to the shared issue-group header, the
group / filter / sort toolbar and its persistence — because that screen asks "what am I actually
paying for" about one parcel, and the answer is a list of stamps. The flat watchlist keeps plain
rows and opens the same list in a dialog: there the question is "what do I bid on next" across every
seller, and forty cards of contents is the wrong shape for it. Only the sale read carries the lines;
the watchlist row carries the total, or a forty-lot list would fetch forty compositions to draw
forty collapsed rows.

### 7. Settlement is a 1:1 transcription, and a lost lot is the price signal

Winning settles the sale into the acquisition model rather than creating a parallel one:
`AuctionSale` → `Purchase` (seller, platform, currency, `shippingCost`), each `won` lot →
`PurchaseLot` priced at hammer + premium, lost lots skipped. Shipping is then distributed across
lines by ADR-0009 §3 — which is the whole reason §1 defines the parent as a parcel, since the
grouping was already made at bidding time. `AuctionSale.purchaseId` and `AuctionLot.purchaseLotId`
are unique and `onDelete: SetNull` — the link is 1:1, and deleting the purchase must leave the
bidding record standing, because that record is a datapoint in its own right. Deleting it is
therefore also the undo: `assertLotEditable` freezes a settled lot, since the purchase now carries
the figures that were actually paid.

The composition is **written as copies**, not proposed (#28). An `AuctionLotLine` already says
`stamp × condition × certificate × format × quantity`, which is precisely what a copy is, so a
confirmation step would only ask the collector to re-approve what they typed to decide the bid.
A line of quantity N becomes N `Item`s in the purchase's ordinary intake state — `ordered`, not in
the collection, cost pending — and the existing intake runs unchanged from there. What is confirmed
instead is the **money**, in a review step before anything is written: the seller's invoice is the
authority, not our arithmetic, so the date, the shipping, every line price and *which* won lots are
in this parcel are all pre-filled and all editable. A won lot left out stays `won` and unsettled —
a seller shipping one lot separately is a fact about the parcel, not an error to refuse.

Losing produces the other output: `finalPrice` + `endsAt` + the composition, with `fxRateToBase`
frozen at `endsAt` through the `Purchase` mechanism from #20. That is what #24 consumes. It costs
nothing extra to capture — the composition was entered to decide the bid — which is the whole
argument for getting market data this way instead of importing it.

Three consequences of that, settled with #354 and amended by §4. The rate is stored **only where
there is a price to convert**: null covers "the sale is already in base currency", "no rate could be
had" and "no result was ever seen", all of which mean the same thing to a reader, and freezing
today's rate against an absent observation would only look like data. Nothing is ever **inferred**
into `finalPrice` — the last bid recorded is a lower bound on the result, so the entry form leaves
the field blank rather than offering a guess, and closing a lot you bid on without a price is refused
outright. And `cancelled` is a **lifecycle state, not a flavour of lost**: a listing withdrawn or
ended without a sale produces no datapoint at all, so recording one clears the price, its rate and
the tie-break together, exactly as putting a lot back to `open` does. Every move is reversible,
because misfiling a lot is a clerical error and a watchlist that cannot take one back invites leaving
it wrong.

Settlement still operates on *a sale holding won lots*, but it now reads won-ness off the money
(§4) rather than off a flag: a sale reaches that state by having its figures entered, not by being
told twice. Closing a lot stops at the figures and writes no `Purchase` — the parcel is settled as a
whole, once, when the seller has invoiced it, and a per-lot purchase would be the parallel
acquisition path this section exists to refuse. What closing does change at once is the parcel's own
rollup, which then costs a won lot at what was paid rather than at the last bid anybody happened to
observe.

One constraint this places on §4, and it holds: a settled lot **must** keep deriving to `won`, or
what settlement wrote and what the lot reads back would disagree. `assertLotEditable` freezes a
settled lot's figures, so once true it stays true — which is what made deriving the outcome safe on
this side of the fork at all.

### 8. Data entry is manual, plus one assisted capture path

Manual entry, plus Stamporama Assistant support for `allegro.pl` (#355; ADR-0015/ADR-0017): a click
on a listing captures URL, title, the marketplace's own **offer number** (into `lotNo`, the slot a
house sale's lot number occupies), **seller**, closing date and current bid through an
`AssistantToken`-authenticated endpoint (`POST …/auctions/capture`), reviewed in a window of the
Assistant's own before anything is written. Composition is always entered by hand — it cannot be
extracted from a listing reliably.

Four rules that fall out of the model above rather than out of the extension:

- The **platform is a setting**, not something the capture reads: the page knows it is Allegro, but
  which `Contact` that marketplace is, is a fact about the collection. `Contact.platformModule`
  carries it (the marker #406 introduced), set on **Settings → Allegro**.
- The **seller** is read off the page as a *proposal* and resolved by name exactly as a name typed
  into the add-lot dialog is; the parcel then follows from seller + platform through §9's open-sale
  matching, re-read server-side rather than trusted from a browser extension.
- **Only auctions.** A fixed-price offer has no bid to observe and no close to age against, so it is
  refused rather than turned into a lot with an invented closing time.
- A **re-capture is a refresh**, recognised by the marketplace's own offer id in either of the two
  places it is recorded — `lotNo` (equality, scoped to that platform's sales) or the stored URL (at
  the address's own boundaries) — so a lot added by hand with only the number, or only the link, is
  still recognised. It re-records `currentBid` + `checkedAt` and
  nothing else, since everything else on the lot is what the collector has since typed. That makes
  the extension the fastest expression of §5's manual refresh, not an exception to it.

There is no scraping and no scheduled bid refreshing. Both are fragile dependencies on markup and
terms of service we do not control, and they would be a separate architectural decision, not a
detail of this one.

**Amended by #481 — for the selling side only.** A bid is refreshed **automatically** where the
instance holds an API grant for the marketplace *and the listing is the collector's own*: Allegro's
own feed states the standing bid and the bidder count on the seller's offers, so a figure typed by
hand there is a worse figure. That is the sold-side sync's business and is decided in ADR-0024 §8a
(`Offer.price` / `priceCheckedAt` / `bidderCount` / `endsAt`, off `GET /sale/offer-events`).

The decision above stands unchanged for **tracked lots** — everything this ADR is about. Those are
other sellers' listings, they are not in `GET /sale/offers`, and no grant this instance holds says
anything about them; `AuctionLot.currentBid` / `checkedAt` stay manual, refreshed by hand or by the
Assistant's re-capture. What changed is not the principle but the evidence available: an
authoritative feed of one's *own* listings did not exist when this was written.

### 9. The flat list of lots is the primary screen; the sale is a grouping

The **Auction sales** nav page leads with a flat list of lots across all sales — status / platform /
seller filter chips (#332), sale as a column with optional grouping, inline bid editing — so
"everything I have running on Allegro" needs no navigating between sales. Sale detail exists
separately, for settlement and shipping.

This follows from §1 again. The sale is a settlement boundary, which matters twice (when a lot is
added, and when the parcel is paid for) and is in the way the rest of the time. What the collector
does daily is scan closing times and refresh bids, and that is a list of lots.

Consequently, adding a lot never starts by picking a sale: the dialog takes seller and platform, and
proposes the open sale for that pair if one exists, with the option to start a new one.

## Consequences

- Three new tables — `auction_sale`, `auction_lot`, `auction_lot_line` — and four nullable columns
  on `contact`. No backfill: an existing contact simply states no defaults.
- No new pricing, currency or cost-distribution mechanism. Catalogue value, format factors, FX
  freezing and shipping allocation are all existing machinery, reached through existing modules.
- The auction layer is **optional and skippable**: a purchase can still be entered directly. Nothing
  outside the auction screens depends on these tables.
- Market price data accumulates only for lots the collector actually bid on. That is a deliberately
  narrow sample, and #24 must treat it as such.
- If bid refreshing ever becomes automated, `checkedAt` is already the field it would write, but
  §5's "no history" decision would have to be revisited — cheap polling changes what a history costs.
