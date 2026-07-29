# Auction sales

Auction tracking is a **bidding watchlist with a fork at the end**. You record what you are bidding
on, keep the bids current while the lots run, and each lot ends either won — settled into a
[purchase](purchases.md) — or lost, which leaves behind what the material actually fetched.

Open **Auction sales** from the **Buying** section of the sidebar. It opens on the **lots**, not on
a list of sales: what you do daily is scan closing times and refresh bids, and that is a list of
lots. The sales themselves are one click away, for paying for a parcel.

## Two levels: the sale is a parcel, the lot is a thing

- An **auction sale** is **one settlement with one seller** — what ships to you in one parcel. For
  an auction house that is the house's own sale (`Köhler 385`). On a marketplace it is an
  open-ended basket of everything you are currently bidding on with one seller.
- A **lot** is one thing being bid on, inside a sale. The outcome lives **on the lot**: within one
  sale you normally win some lots and lose others.

Everything about a parcel is priced on the sale — the **currency**, the seller's **buyer's premium**
(a percentage, a per-lot fee, or both), and **shipping**. Shipping is counted **once** per sale
however many lots you win, which is exactly why a sale is defined as one parcel.

Both parties are [contacts](contacts.md): the **seller** is who you are buying from, the
**platform** is what the sale is routed through. A house selling directly is both. A house listing
through an aggregator such as philasearch is the seller; the aggregator is the platform.

## Adding a lot

Click **Add lot**. You are never asked to pick a sale first — you know the seller and the platform,
and the settlement follows from them:

1. Name the **seller** and the **platform**. Either can be typed in; a name that does not exist yet
   is created as a contact. Once you have tracked a lot with a seller, picking them again fills in
   the **platform you last used for that seller** — a house that always comes through one
   aggregator never has to be told twice, and a seller you reach directly stays direct. It is only
   a suggestion: type over it and it stays typed over. The memory is stored on the seller's
   [contact](contacts.md), so it holds on every device you sign in from, and it is kept apart from
   the platform the [offers](offers.md) screen remembers — where you *bid* and where you *list* are
   usually different marketplaces.
2. Stamporama looks for an **open sale** for that pair.
   - If there is one, it says so: *Adding to Philkam · Allegro — 3 lots, PLN*. When that sale has a
     closing date of its own — a house sale closes all its lots on one evening — it fills the lot's
     **Closes** field in; a marketplace basket has none, so there each lot keeps its own moment.
     **Start a new sale instead** is right beside it, for when the previous parcel has already
     shipped: that settles separately, so its shipping is distributed separately.
   - If there is none, a new sale is started, named after the seller and the platform, with the
     seller's own **currency, premium and shipping** copied onto it.
3. Fill in the lot: the **listing URL**, **lot number** and **title**, when it **closes**, then the
   auction's own figures — the **starting price** and the **current bid** — and finally yours:
   **my bid** and **my ceiling**.

Leave the **title** blank and the lot is **named after what it holds**: the catalogue numbers with
their prefix, collapsed into ranges, then the issue when every line shares one — *Mi·PL 1-12 ·
Definitives (1950)*. The prefix is written once around the span and is what says *which* catalogue
the numbers are from, so a lot spanning two areas reads *Mi·PL 1-3, Mi·DE 5* rather than a run of
numbers that could be anything. A lot
spanning several issues reads as its size instead (*14 stamps · 3 issues*), because a name is meant
to be read at a glance down the watchlist. Nothing is stored: the name follows the contents as you
add lines, and typing a title of your own replaces it for good. The title field's placeholder shows
the name the lists are currently using.

The **starting price** is optional and is a record, nothing more: it is what the lot opened at, not
what anyone has bid. A lot with no bid recorded costs nothing whatever it opens at, so the starting
price never counts toward an all-in figure or a parcel total.

The closing time is entered in your own time zone. It is what the watchlist is ordered by and what a
bid's age is measured against, so it is the one required field.

A seller's defaults are **copied onto the sale**, never referenced from it. Raising a seller's
premium on their contact never re-prices a parcel you are already bidding on. Change a parcel's
terms on the sale itself.

## The lots screen

The right of each row is a small grid — three figures, each shown **twice**:

| | **Auction** | **Mine** | **Ceiling** | **Catalogue** |
|---|---|---|---|---|
| **bid** | what the lot stands at | what you placed | the most you could bid | what the contents are worth |
| **all-in** | what that would cost | what yours would cost | the most it is worth to you | what is left over |

The first three columns are what the lot **costs**; the fourth is what it is **worth**, and it only
fills in once you have said what the lot contains — see [What a lot contains](#what-a-lot-contains)
below. The **bid** line is hammer prices, the **all-in** line adds the seller's premium. Each pair has one
figure you type and one derived from it, shown muted: the auction's bid and yours are bids, a
ceiling is a valuation of the total. The ceiling's muted half is exactly what *Bid my ceiling*
would place.

Shipping is deliberately in none of them. It belongs to the parcel, so it is added once on the
sale, not once per lot.

**Auction** and **Mine** are two different facts, and keeping them apart is the point: `40` on its
own cannot tell "I am leading at 40" from "someone outbid me at 40". Once both are recorded the row
says **Leading** or **Outbid** — worked out on every read, never a flag you set, because a flag
would be wrong the moment the price moved.

Each figure is tinted about its own side. Yours is **green** while it still covers the price and
**grey** once it has been passed — a bid that is out of play, not a problem. The auction's price is
what turns **red**, because the price running away from you is the thing you might still answer.
Red is never used on your own figure for that: there it already means *over ceiling*.

Once the closing time has passed the same comparison becomes a result: **Won?** or **Lost?**. The
question mark is honest — it is inferred from the last bid you recorded, not from the platform.
Recording the outcome on the lot replaces it with a plain **Won** or **Lost**.

Your figures turn **amber** when the bid you placed would, all-in, cost more than your ceiling. That
is a different kind of news from the price running away from you — it is your own commitment, and
the only one of the two you can still take back.

### Bidding to your ceiling

**Bid my ceiling** in the row's ⋮ menu records the largest bid that still fits inside your ceiling —
and that is *not* the ceiling itself. The ceiling is an all-in figure; a platform's bid box takes a
hammer price. On a house charging 20% plus a 2 fee, a ceiling of 100 means bidding **81.66**, which
costs 99.99 all-in; bidding 100 would cost 122.

It rounds down, so the all-in never creeps past the limit, and it is unavailable when there is no
ceiling yet or when the fees alone already exceed it — the menu says which. Placing the bid at the
platform is still yours to do; this records what you placed.

### Closing times

The closing time on the right of each row reads *closes in 3 days* while the moment is ahead and
*closed 2 days ago* once it has passed. Colour there means **act now**, so only a deadline you can
still do something about gets any: **red** inside two hours, **amber** inside a day, plain text
further out.

A lot whose moment has gone by is **greyed out entirely**, row and all. There is nothing to react to
— the bidding happened without you — and an alarm on it would compete every day with the lots that
can still be won. They are not lost, though: the **Ended** filter on the toolbar is how you go and
find them to record what happened, alongside **Closing today** and **This week** for the other end
of the same question. Unlike the status and party filters, the closing window is not remembered
between visits — coming back tomorrow to a list silently narrowed to old lots would hide everything
that is actually running.

### Keeping bids current

There is no scraping and no automatic refreshing — you check a listing and record what you see. Two
ways, both one click from the list:

- **type the new bid** over the old one, or
- pick **Bid unchanged** from the row's ⋮ menu when it has not moved.

Either way the observation is stamped with the moment you made it, and that is what the staleness
signal reads:

- **Stale** — the reading is old *relative to how soon the lot closes*. A lot closing in an hour
  goes stale in minutes; one closing next month keeps a day-old reading. Bids move as the close
  approaches, which is exactly when the mark tightens.
- **No bid yet** — nothing has ever been recorded for this lot.
- **Closed** — the closing time has passed and the lot is still being watched. Unlike a stale
  reading, this one will not fix itself: what is missing is the outcome.

A lot that is current shows no mark at all.

### Recording what happened

Once a lot has closed, the row's ⋮ menu files it:

- **Mark as won** — it is yours. It asks for **what you paid**: the hammer price, before the
  seller's premium, in the sale's currency. The premium and the shipping belong to the parcel and
  are added there, once.
- **Mark as lost** — you were outbid, or it went unsold. It asks for **what it went for**, the same
  figure on the other side of the result.
- **Mark as cancelled** — the seller withdrew the listing, or it ended without a sale. No price, no
  record of a result.
- **Back to watching** — undoes either, for a lot filed by mistake. If a final price was recorded,
  it warns before discarding it.

On a **lost** lot the price is **optional, and left blank on purpose**. If the lot vanished before
you saw the result, leave it empty: that records the loss without inventing a figure. The last bid
you recorded is not the answer either — it is only what the price had reached the last time you
looked, which is why it is never filled in for you, on either outcome.

On a **won** lot the price is required. You paid it, so there is nothing to have missed, and it is
what the parcel's total is worked out from — and, once settling a sale exists, what prices the
purchase line.

Recording a price is what turns a lot you lost into a **price datapoint**: a real price, for a
composition you already described, on a known date. The exchange rate of that moment is frozen with
it, so a result from three years ago keeps saying what it cost three years ago rather than being
quietly revalued at today's rate.

Once a result is recorded, the row shows it in place of the last bid — that is what the lot actually
went for, and it is the figure the all-in beside it is worked out from. The **Won?** / **Lost?**
guess disappears, replaced by the plain status.

Lost lots stay on the list and stay filterable. They are the archive the market data comes out of,
not clutter to be cleared away.

Won lots stay on the list too, and count into what the parcel will cost — a won lot is priced at
what you actually paid rather than at the last bid anyone saw, so the sale's total stops being an
estimate. Marking a lot won does **not** create a purchase on its own: you pay for the parcel as a
whole when the seller invoices it, and that is [**Settling**](#settling-a-parcel-into-a-purchase),
one step for the whole sale.

### Filtering and grouping

The toolbar filters on two different questions. The first row is **what to do about a lot**, worked
out from its figures rather than recorded by you:

- **Can still bid** — your ceiling leaves room above the current price, so this lot can be taken
  without going past what it is worth. This is the one that turns the list into a to-do.
- **Outbid** / **Leading** — where your placed bid stands against the price.
- **Over ceiling** — all-in, the price has passed what the lot is worth to you, whoever is winning.
- **Won?** — it closed with your bid ahead and the outcome has not been recorded yet.

These only ever describe a lot still being watched: once you record an outcome there is nothing left
to decide, and the status says it plainly.

The second row is **what became of it** — the recorded outcome:

- **Status** chips — *Watching*, *Won*, *Lost*, *Cancelled*, each with a count. Watching lots read
  soonest-closing first; a settled status reads most-recent first. With no status chosen the list is
  everything, newest tracked first.
- **Seller** and **platform** selects, so "everything I have running on Allegro right now" is one
  filter rather than a walk through parcels.
- **Group by sale** turns the flat list into sections, off by default.

Your choices are remembered per collection and are also in the address bar, so a filtered view can
be bookmarked or shared.

## Sales — paying for a parcel

**Sales →** on the toolbar lists the settlements. Each row shows the parcel's **all-in total**:
every bid you would actually pay for — *watching* and *won* lots — plus the premium on each, plus
shipping once. A lost lot costs nothing and is left out of the total. Beside it is the parcel's
**catalogue total** over the same lots, and the headroom between the two — this time with shipping
included, because that is what the parcel actually costs.

**Add lot** on a sale's own screen puts a lot straight into that parcel — no seller, platform or
matching to go through, because the settlement is already the screen you are on. Its closing date
fills the lot's in, and the amounts are in the sale's currency.

A sale's own screen shows its terms and its lots, and is where you:

- rename it (`Köhler 385`), set its **catalogue URL** and its **closing date**,
- correct the **currency**, **premium** and **shipping** for this parcel,
- **close** it when nothing was won — only an *open* sale is offered when you add the next lot for
  that seller.

Its lot cards carry the same two rows of chips the flat list has — *can still bid*, *outbid*, *over
ceiling* and the rest, then the recorded outcomes — asked of this one parcel. Only what the parcel
actually holds is offered, and the choice is not carried between visits: it is a working filter, not
a view.

**New sale** on the sales screen is for the auction-house case, where the sale is known up front and
you add lots into it. You never need it for a marketplace basket; that one is created for you by the
first lot.

A sale can only be deleted once it holds no lots — deleting a parcel must not quietly take the
bidding record with it.

## What a lot contains

A lot's contents are a list of lines, and each line is a **stamp, a condition, a certificate, a
physical format and a quantity** — the same five things a catalogue price is recorded against.
There are three ways in:

- On the **sale's own screen** each lot is a **card you expand** — the same arrangement a
  [purchase order](purchases.md) and an [offer](offers.md) use for their contents — with the lines
  listed underneath and one toolbar over the lot. That is where a parcel gets described, because
  that is where you are asking what you are actually paying for.
- On the **lots watchlist**, **Contents** in a lot's ⋮ menu — or the **Catalogue** figure on the
  row, which is the same door — opens the same list in a dialog, for when you want to describe one
  lot without leaving the list you are working through.
- **Add lot** itself has a **Contents** section, so a lot and what it holds are saved in one go.
  Capturing a listing and saying what is in it is one act — you are reading the description as you
  type — and it is optional: a lot can always be described later. If a line is refused, nothing is
  saved, so you never end up with a lot that looks entered but is empty.

Adding a line is **two steps**, the same two the purchase-order intake uses. **+ Add line** opens the
stamp browser straight away; once you have picked, a second dialog asks for the **condition,
certificate, format and quantity**, with what you picked restated at the top and **← Back** to
change it. They are separate because they are two different questions asked of two different
sources: the first is answered from your catalogue, the second from the listing text in front of
you.

The condition and certificate start from the ones you last used — the same pair every add-copy
screen remembers, since it is the same question about the same material.

Either way:

- Pick with the usual browser: area → issue → stamp. You can pick **a single stamp or a whole
  issue** — the same choice the [purchase order](purchases.md) intake gives you. A house lot that
  says *Michel 1–12, complete* is one pick: the issue expands into one line per stamp marked
  **required for completeness**, all described the same way. The series is only a shortcut for
  entering them; what is stored is still a line per stamp, because that is what a catalogue value
  sums over and what a lost lot has to be attributable to. Editing an existing line offers stamps
  only — turning one line into twelve is not an edit.
- **Condition** is what the lot is described as being in. **Certificate** is *None* unless the lot
  is sold with one — an Attest is a large part of why a lot is worth what it is, and the value is
  read at exactly the level you name here. **Format** is *Single* unless the lot is a pair, a block
  or a strip.
- **Qty** is how many of *that* the lot holds — three of one stamp at one condition is one line with
  a quantity of 3, not three lines.

This is deliberately structured rather than a free-text description. It is what makes a catalogue
value computable at all, and it is what turns a lot you **lose** into a usable record of what the
material fetched.

### What each line is worth

Every line is valued from the catalog exactly the way a copy in your [inventory](inventory.md) is —
the same rules, so the two can never disagree:

- **Variant not identified?** Point the line at the **base stamp**. That is how "one of these, and
  the listing does not say which" is expressed, and its value is then the **cheapest** of that
  stamp's variants. It is shown as `~20.00` in muted italics, the mark this app uses everywhere for
  *inferred, not recorded*.
- **The condition, certificate and format must all match.** Matching is strict, exactly as it is for
  a copy: a lot described as carrying a Fotoattest stays unpriced until a catalogue value exists at
  that certificate level. That is not a gap in the data so much as a question the catalogue has not
  been asked yet — and the **+ catalog value** link fills it in at the right level.
- **A multiple is priced as that multiple.** An explicit catalogue price recorded for the format wins;
  failing that, the single's price is multiplied by that format's multiplier. With **neither**, the
  line is left **unpriced** — never quietly valued at the single's price, which would be a different
  stamp's figure.
- A line with no catalogue price at all shows a **+ catalog value** link in place of the figure.
  Click it and the usual catalogue-value dialog opens on that stamp at that condition and format, so
  you can fill the gap without leaving the lot.

Unpriced lines are **counted and reported**, never dropped silently: the totals footer says how many
there are, so a value that is only half the lot never looks like a finished answer. A lot with lines
but no prices at all shows **no value**, not `0.00` — it is unanswered, not worthless.

Values are converted into the **sale's currency**, which is what the bids and your ceiling are in.
If a price is in a currency with no available rate into it, the line says so rather than being
counted as unpriced — it has a value, it just cannot be expressed here.

Conversion goes through your collection's base currency, so a price already recorded in the sale's
currency is converted out and back. All the rates behind that come from **one dated snapshot** of
the ECB table, which is what makes the two directions exact opposites: a price of 1500 EUR on a sale
in EUR reads as 1500, not 1498.44. (Older data, cached before this, could drift by around a tenth of
a percent; it is replaced the first time a rate is looked up.)

### Headroom

The footer of the editor, and the second line of the **Catalogue** column on the row, is the
**headroom**: the catalogue value less what the lot actually costs you.

> headroom = catalogue value − (bid + the seller's premium)

Green while there is room left, red once the price has passed what the contents are worth. It is
measured against the **all-in** cost, never the hammer price: a ceiling set against the hammer price
alone systematically overpays on cheap lots, where the fees are a large share of what leaves your
bank account.

Shipping is not in the row's figure, for the same reason it is in none of the others — it belongs to
the parcel. The **sale's** own total does include it, once, so the parcel's headroom on the sales
screen is the whole picture.

### The parcel screen

A sale's own screen draws its lots as cards, each one the watchlist row you already know — the same
figures, the same in-place bid editing, the same ⋮ — with a caret that opens what the lot holds.
Underneath every card sits its own footing: how many lines and stamps, what they are worth, and the
headroom against the current bid.

One toolbar governs all of them, and it is the toolbar the purchase-order and offer screens have:

- **Group by Lot** is the default — a parcel is a set of lots, and each is bid on separately.
  Turning it off flattens the whole parcel into one list of stamps, which is how "did I already bid
  on this one somewhere in here?" gets answered. In that flat view lines can still be priced, but
  editing one happens in its lot's card.
- **Issue** sub-groups the lines under whichever of the two is showing, with the same collapsible
  issue header the other screens use.
- **Only** narrows to the lines that need work: **unpriced**, **no photo**, **unknown variant**.
- **Sort lines** orders them by the same keys copies are sorted by — order added, year, catalog
  number, price, name — with a direction toggle.
- **Collapse all** / **Expand all** for the cards themselves.

The grouping and sorting choices are remembered per collection, exactly as they are on the other two
screens. The **Only** filters are not: they are a job you do and finish.

## Settling a parcel into a purchase

Once every lot in a sale has an outcome recorded, the sale's own screen offers **Settle…** — the
step that turns what you won into a [purchase](purchases.md). It is the end of the auction side and
the beginning of the ordinary one: from there the parcel is an order like any other.

There is nothing to decide here, which is the point. A sale is already one settlement with one
seller, so no question is left about which purchase a lot belongs in; settling is transcription. The
dialog exists only because **the seller's invoice is the authority**, not our arithmetic — so
everything in it is filled in and everything can be corrected:

- the **purchase date**, defaulting to the sale's closing date. The exchange rate of that day is
  frozen onto the purchase, exactly as for a hand-entered one.
- the **shipping**, from the sale's own figure.
- each won lot's **line price**, filled in at the **hammer price plus the seller's premium**.
  Shipping is deliberately *not* in these figures: it is charged once for the parcel and then spread
  across the lines by price, so several auctions won from one seller in one parcel share it
  correctly and without a special case.
- **which won lots are in this parcel at all**. Unticking one leaves it recorded here as won and
  unsettled — nothing about it is lost, it is simply not part of this purchase. That is for the lot
  the seller is shipping separately.

What you get is a purchase with one line per won lot, and — this is the part that saves the
typing — **the lots' contents already identified as copies on those lines**. You described them to
decide the bid, so there is nothing to enter again: each line's stamp, condition, certificate and
format come across as they were, and a quantity of three becomes three copies. They arrive in the
normal intake state: bought, not yet in hand, not in the collection until you have sorted them. From
there the [purchase](purchases.md) screen runs exactly as it does for any other order — sorting,
closing each lot, freezing the cost basis.

A lot with nothing described becomes a priced line with no copies, which you can identify on the
purchase in the usual way.

Lost and cancelled lots are skipped and stay exactly where they are: a lost lot is a price
observation, and that is the other half of what this feature is for. A sale where **nothing** was
won has no purchase to make, so the button reads **Close sale** instead.

Afterwards the two records point at each other — the sale links to its purchase, the purchase back
to the sale — and the bidding record is frozen: to change a settled lot's figures, edit the
purchase. Deleting the purchase is how a settlement is undone; the sale, its lots and their results
stay standing, only the link goes.

## What is not here yet

- Winning **part** of a lot, when a multi-stamp lot is split.
- Anything that reads the prices lost lots have produced back as a valuation.
- Any recommendation beyond the raw catalogue value — what a lot is *worth bidding* is a separate
  question from what its contents catalogue at.
- Capturing a listing straight from the browser.

A lot's **notes** field is a good place for anything the contents list has no room for — condition
doubts, what to check before bidding.
