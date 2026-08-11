# Auction tracking

Auction tracking is a **bidding watchlist with a fork at the end**. You record what you are bidding
on, keep the bids current while the lots run, and each lot ends either won — settled into a
[purchase](purchases.md) — or lost, which leaves behind what the material actually fetched.

**Auctions** in the **Buying** section of the sidebar opens onto two entries. **Lots** is the
watchlist — every lot across every seller, which is where the daily job is done: scanning closing
times and refreshing bids. **Sales** is the settlement side, one row per parcel, which is where you
go when an invoice arrives. They are separate destinations because they are separate jobs, done on
different days; the cross-links between them are described below.

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
   - If there is none, it says *Starting a new sale: Philkam · Allegro*, with the seller's own
     **premium and shipping** copied onto it. That is what you see for a seller you are naming for
     the first time too — they have no sale to attach to, because they have no history at all.
   - The new sale's **currency** is shown right there and can be changed before you save. It is the
     seller's own currency when they have one; failing that the platform's fixed currency, so a lot
     on a zloty-only marketplace opens in PLN rather than in something nobody chose; failing that
     your collection's base currency. Every amount on the lot is entered in it, and it stays
     editable on the sale itself afterwards.
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

### Capturing a lot from the listing instead

On **Allegro**, the four fields above are already written on the page you are looking at, and the
[Stamporama Assistant](assistant.md#capturing-an-allegro-lot) can read them: click its toolbar icon
on an auction and it captures the address, title, offer number, seller, closing time and current bid
into a small window, shows you which parcel the lot would land in, and saves it on one click. Capturing the same
listing again refreshes its bid rather than making a second lot.

It needs one setting first — **Settings → Allegro**, naming which of your platforms *is* Allegro —
and it never reads the lot's contents: what a lot holds is still entered here, on the lot itself.

## The lots screen

Each lot carries two numbers, and they mean different things. `#3` in muted type is **the
collection's own number** for the lot — always there, never reused, and what the sidebar's **Jump
to…** box takes as `lot 3` ([Quick jump](quick-jump.md)). The boxed chip beside it is the
**house's** lot number, as printed in the catalogue or captured from the marketplace; only some
lots have one, and it repeats freely across sales.

The right of each row is a small grid in **two halves, divided by a rule**: what the lot **costs**,
and what it is **worth**. Each half has its own two row labels, because the two lines mean something
different on each side.

What it costs:

| | **Auction** | **Mine** | **Ceiling** |
|---|---|---|---|
| **bid** | what the lot stands at | what you placed | the most you could bid |
| **all-in** | what that would cost | what yours would cost | the most it is worth to you |

What it is worth:

| | **Catalogue** | **Recommended** |
|---|---|---|
| **value** | what the contents are worth | [what it is worth bidding](#what-a-lot-is-worth-bidding) |
| **headroom** | what is left over | what is left before you overpay |

Two answers to the same question, deliberately side by side: the catalogue says what the contents
list at, the recommendation what your own recorded results suggest paying for them. Each headroom is
that column's figure less what the lot costs at the current bid — so one tells you whether you are
buying under the book, and the other whether you are still inside what the evidence says.

Every figure is in the **sale's** currency — a lot has none of its own — and where that is not the
currency your collection counts in, a smaller `≈ 25.00 EUR` sits under it. On the flat watchlist
only the **bid** carries one: the list is scanned down a column of forty rows, and a second line
under every figure would double the height of all of them. A sale's own screen converts the lot in
full, and the parcel's totals with it. The rate is today's, except on a lot whose result has been
recorded — that one keeps the rate of the day it closed, because a lost lot is a *dated* price
observation and revaluing it would make it say something that was never true.

On **your own** figures — *Mine* and *Ceiling*, both their bid and their all-in line — that
converted line is **editable**. What is being decided while you bid is how much of your own money
leaves the account, so `≈ 300.00 PLN` under a ceiling can be clicked and retyped as `350`, and what
gets stored is the SEK (or EUR, or CHF) figure that comes to. It is the same two-sided editing the
bid and its all-in already have, with a third side: whichever one you type into, the sale's currency
is what is kept, because that is what the platform's bid box takes and what the invoice will say.
An empty figure still offers the line, so a limit can be **named** in your own currency rather than
only corrected in it, and clearing it clears the amount in both. What the lot **stands at** is not
editable this way: that number is copied off the listing, in the currency the listing states it in.

On the **cost** side each figure exists twice: the **bid** line is hammer prices, the **all-in**
line is the same figure with the seller's premium added. Exactly one of each pair is what gets
stored — the auction's bid and yours are bids, a ceiling is a valuation of the total — and the other
is worked out from it and shown muted. The ceiling's muted half is exactly what *Bid my ceiling*
would place.

In your own two columns, **Mine** and **Ceiling**, you can type into **either half**. The two cells
are one fact said two ways, so say it whichever way you have it to hand: put `50` in your **all-in**
cell and the bid that costs that much is stored; put `40` in the ceiling's **bid** cell and the
ceiling becomes what bidding 40 would cost you. Which of the two is the one actually kept is not
something you need to think about.

Both directions round to the cent that keeps the figure you typed intact: an **all-in** target
reads back as the total you asked for, and a bid typed into the ceiling's bid cell stays placeable
under the ceiling it produces. The **Auction** column is one-way on purpose: that bid is an
observation of what someone else did, and there is nothing to state twice about it.

The **worth** side is not a third and fourth of those. Its top line, **value**, is the catalogue
value of what you said the lot holds — see [What a lot contains](#what-a-lot-contains) below — so it
stays empty until you have described the lot. Its bottom line, **headroom**, is a *subtraction*, not a
recomputation: catalogue value **less** the auction's all-in cost, i.e. the cell above it less the
cell in the **Auction / all-in** corner. That is why the labels differ. Nothing on this side is a
bid, and nothing on it is a cost.

A lot with nothing described yet says so, with an amber **Not described** chip among the row's other
chips — on this list and on the lot's card on its parcel's screen. It is not an error: an empty
composition is where every lot starts, and the chip is there because everything on the **worth**
side stays blank until it is filled in. Cancelled lots never carry it. The **Not described** filter
below collects them.

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

A colour applies to the **whole column, both of its lines**. The bid and the all-in under it are one
figure expressed twice, so your bid is green on both lines while it leads, and the auction's column
is red on both when the price has passed either your bid or your ceiling. Weight is what still tells
the two lines apart — the one that gets stored is solid, the one computed from it is muted. Once a
result has been recorded the tinting stops altogether: leading and outbid are positions in a race
that is over.

Once the closing time has passed the same comparison becomes a result: **Won?** or **Lost?**. The
question mark is honest — it is inferred from the last bid you recorded, not from the platform.
Recording the outcome on the lot replaces it with a plain **Won** or **Lost**.

Your figures turn **amber** when the bid you placed would, all-in, cost more than your ceiling. That
is a different kind of news from the price running away from you — it is your own commitment, and
the only one of the two you can still take back.

**Clicking a row opens the parcel it belongs to**, with that lot scrolled to and marked so you do
not have to find it again among the sale's other lots. The mark is not a flash you can miss: the
card is outlined and carries an *Opened from the watchlist* strip, and it **stays** until you clear
it with the ✕ on that strip. Clicking any of the row's own controls does what that control does
instead — the figures stay editable in place, the chips and the ⋮ menu
keep their own behaviour — and selecting text on the row does not navigate. Hold ⌘ or Ctrl to open
the sale in a new tab.

### Bidding to your ceiling

**Bid my ceiling** in the row's ⋮ menu records the largest bid that still fits inside your ceiling —
and that is *not* the ceiling itself. The ceiling is an all-in figure; a platform's bid box takes a
hammer price. On a house charging 20% plus a 2 fee, a ceiling of 100 means bidding **81.66**, which
costs 99.99 all-in; bidding 100 would cost 122.

It rounds down, so the all-in never creeps past the limit, and it is unavailable when there is no
ceiling yet or when the fees alone already exceed it — the menu says which. Placing the bid at the
platform is still yours to do; this records what you placed.

### Filling a figure in from one you already have

Three of these figures are worth copying rather than retyping, and each is offered twice: as an
entry in the row's ⋮ menu, and as a small button that appears when you hover the row, just right of
the column it fills. The button is labelled with the **column the figure comes from**, shortened —
`CEIL` for your ceiling, `CAT` for catalogue value — so it says what it does without needing to be
learned.

| Action | Button | Writes | From |
|---|---|---|---|
| **Bid my ceiling** | `CEIL` | Mine / bid | your ceiling |
| **Bid catalogue value** | `CAT` | Mine / bid | the lot's catalogue value |
| **Ceiling = catalogue value** | `CAT` | Ceiling | the lot's catalogue value |
| **Ceiling = recommended bid** | `REC` | Ceiling | the [fair figure](#what-a-lot-is-worth-bidding) |

The buttons sit **between the two lines** of their column, not on either one, because a quick fill
sets the column as a whole: fill in a bid and the all-in under it follows, set the ceiling and the
bid it allows follows. Where a column offers two, they are stacked one under the other. They sit
just **after** the figures rather than before them — amounts are right-aligned, so that is the side
their own number is on.

The two that place a **bid** go through the same arithmetic *Bid my ceiling* does, because both
sources are all-in figures and a bid box is not: on a house charging 20%, a catalogue value of 100
means bidding **83.33**. The two that set the **ceiling** copy across unchanged — a ceiling is
itself an all-in valuation, so there is nothing to convert.

`CAT` and `REC` sit one under the other on the ceiling column, and both stay: *what the catalogue
says* and *what it is worth bidding* are different statements, and the catalogue one is still the
honest answer on a lot nothing has been recorded against. `REC` always writes the **fair** figure;
the floor and the walk-away are taken from the panel or the ⋮ menu instead.

Every one of them is a starting point, never a link: the field stays yours to edit afterwards, and
nothing recomputes it if the catalogue value later changes.

An action whose source is missing is shown greyed out with the reason underneath, rather than
hidden — most often *describe what the lot holds first*, since catalogue value follows from
[what you say a lot contains](#what-a-lot-contains). The ceiling can be filled in on a lot that has
already closed; the two that place a bid cannot, because there is nothing left to bid on.

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

Both ends of that question are also reported by [Action items](action-items.md), the bell at the top
of the sidebar: lots closing within the day, and ended lots still waiting for their outcome to be
recorded. It is the same two filters, counted for you, so a lot that quietly closed while you were
elsewhere does not have to be gone looking for.

### Keeping bids current

There is no scraping and no automatic refreshing — you check a listing and record what you see. Two
ways, both one click from the list:

- **type the new bid** over the old one, or
- pick **Bid unchanged** from the row's ⋮ menu when it has not moved.

On Allegro there is a third: click the [Assistant's](assistant.md#capturing-an-allegro-lot) toolbar
icon on the listing itself and save. It recognises the lot you already track and records the price it
reads, which saves reading a figure off one window and typing it into another.

Either way the observation is stamped with the moment you made it, and that is what the staleness
signal reads:

- **Stale** — the reading is old *relative to how soon the lot closes*. A lot closing in an hour
  goes stale in minutes; one closing next month keeps a day-old reading. Bids move as the close
  approaches, which is exactly when the mark tightens.
- **No bid yet** — nothing has ever been recorded for this lot.
- **Closed** — the closing time has passed and the lot is still open. Unlike a stale reading, this
  one will not fix itself: what is missing is the final price.

A lot that is current shows no mark at all.

### Closing a lot

Once a lot has closed, the row's ⋮ menu files it:

- **Close the lot** — asks for **what it went for**: the hammer price, before the seller's premium,
  in the sale's currency. The premium and the shipping belong to the parcel and are added there,
  once.
- **Mark as cancelled** — the seller withdrew the listing, or it ended without a sale. No price, and
  no record of a result.
- **Back to open** — undoes either, for a lot filed by mistake. If a final price was recorded, it
  warns before discarding it.

There is no *Mark as won* and no *Mark as lost*, because those are not things you tell Stamporama —
they are things it works out. Closing a lot records **what it went for**, and the outcome follows
from that against **your bid**, the maximum you placed at the platform:

| what happened | outcome |
| --- | --- |
| it went for **less** than your maximum | **Won** |
| it went for **more** than your maximum | **Lost** |
| you never bid on it at all | **Watched** |
| the listing was withdrawn or ended unsold | **Cancelled** |

The dialog says which of these it will be as you type, so you see the conclusion before you commit
to it rather than after. The reason it works this way is that winning an auction pays the
runner-up's maximum plus one increment — which always lands *under* your own — while being outbid
puts the result *above* it. Your bid and the final price already contain the answer, so filing it
separately could only ever disagree with them.

**Lots you never bid on.** Adding a lot purely to record what it fetched is a normal thing to do
here — it is how you build a price base for valuing your own material, and it costs nothing beyond
the composition you were going to enter anyway. Such a lot has no bid of yours on it, so closing it
files it as **Watched**: a real price on a real date, and nothing you owe anything on. It is not a
loss, and the list never calls it one.

**If you never saw the result.** A lot you bid on cannot be closed without a price — with your bid
and the final price being the whole of the answer, half of it is not an answer. The last bid you
recorded is not a substitute: it is only what the price had reached the last time you looked, which
is why it is never filled in for you. Leave the lot **open** until you know, or — if you never
really placed that bid — clear your bid on the row, and the lot becomes one you simply watched.

**When it goes for exactly your maximum.** Then the figures genuinely cannot say. Whoever bid that
amount first won it, and that is not something either the platform's page or Stamporama can work
out — so the dialog asks you, once, and only in this case.

Recording a price is what turns a closed lot into a **price datapoint**: a real price, for a
composition you already described, on a known date. That is as true of a lot you only watched as of
one you were outbid on — arguably more so, since recording the price is the entire reason it is
here. The exchange rate of that moment is frozen with
it, so a result from three years ago keeps saying what it cost three years ago rather than being
quietly revalued at today's rate.

Once a lot is closed, the row shows the final price in place of the last bid — that is what the lot
actually went for, and it is the figure the all-in beside it is worked out from. The **Won?** /
**Lost?** guess disappears: it was the same comparison against the last bid anyone happened to see,
and it is replaced by the same comparison against the price you confirmed.

Closed lots stay on the list and stay filterable, but they are **out of the way by default**: the
lots screen opens on what is still open, because that is the watchlist. They are the archive the
market data comes out of, and an archive that grows for ever should not be the first thing between
you and tonight's closing times. Pick an outcome chip — *Won*, *Lost*, *Watched*, *Cancelled* — or
turn on **Show closed** to have them all back at once. See
[Filtering and grouping](#filtering-and-grouping).

Won lots stay on the list too, and count into what the parcel will cost — a won lot is priced at
what you actually paid rather than at the last bid anyone saw, so the sale's total stops being an
estimate. Marking a lot won does **not** create a purchase on its own: you pay for the parcel as a
whole when the seller invoices it, and that is [**Settling**](#settling-a-parcel-into-a-purchase),
one step for the whole sale.

### What it can cost you — the bar above the toolbar

The bar at the top of the lots screen answers the one question a live watchlist is worked against:
*how much of my money is currently on this?* It is always in your collection's own currency, unlike
every other figure on the screen — a watchlist spans platforms, and a sum across two currencies
would not be a sum — and it covers **exactly the lots the filter is showing**, read whole rather
than added up from the rows you have scrolled to. Change a filter and it changes with it.

Two figures, and the gap between them is the decision:

- **Committed** — what you owe if everything goes against you: every lot at the **maximum you have
  placed** on it, plus what the lots you have already won fetched, plus each parcel's shipping once.
  Placing a proxy maximum is a commitment to the platform, so this is the figure to check a budget
  against. A lot you have not bid on costs nothing here — you are not on the hook for it.
- **At ceiling** — the same, if you carried every open lot up to **your own ceiling**. This is the
  one that says whether there is room to keep bidding.

A ceiling is already an all-in figure ([Bidding to your ceiling](#bidding-to-your-ceiling)), so it
counts as it stands — the premium is never added to it a second time. Where the bid you placed is
*higher* than the ceiling, that bid is what counts: it is money committed whatever your valuation
of the lot says.

The note beside them says how many lots were counted, and calls out the two things that would make
the totals read lower than the truth: lots carrying **neither a bid nor a ceiling**, which cannot be
costed at all, and lots in a currency with **no rate** into yours, which are left out rather than
added as though the two currencies were one.

The same pair sits on a sale's own screen, beside its all-in total, for one parcel.

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

The second row is **what became of it** — the outcome, worked out from the figures:

- **Outcome** chips — *Open*, *Won*, *Lost*, *Watched*, *Cancelled*, each with a count. Open lots
  read soonest-closing first; a finished outcome reads most-recent first.
- **Show closed** — with no outcome chip on, the list holds **open lots only**, soonest-closing
  first: a watchlist is what is still to be decided, and everything else is filed. This toggle brings
  the finished lots back — won, lost, watched and cancelled together — which is what you want when
  you are searching for a lot and cannot remember how it ended. Picking an outcome chip already asks
  for closed lots, so the toggle has no say while one is on. Unlike the closing windows it is
  remembered per collection: it is the shape the list should still have tomorrow.
Then, on its own, the one that asks what is **missing from the record** rather than anything about
the bidding:

- **Not described** — lots with nothing recorded as being in them, with a count. These are the lots
  with no catalogue value to bid against and nothing to file if you win, so this chip is how you sit
  down and clear the backlog of them. *Cancelled* lots are never included: describing one buys
  nothing. A **lost** lot is, though — what it held and what it went for is a price record worth
  keeping.
- **Duplicate** — lots holding a stamp another lot you are **winning** also holds, at the same
  condition and format, with a count. It is the standing version of the warning the contents editor
  shows while you type, for the duplicate that came about some other way: the second lot entered last
  week, or a bid that pulled ahead overnight. Only lots you are leading on, or that closed with you
  ahead, are compared, and both sides of a collision are listed. The same set is what the
  [notification centre](action-items.md) reports as *Winning the same stamp twice*.

Finally:

- The **search box** at the head of the toolbar, for when you already know which lot you want: it
  matches the lot's title and notes, the house's lot number, the listing address, the lot's own
  number (`12` or `#12`), and the sale, seller or platform it belongs to. It composes with every
  chip beside it, so a search inside *Can still bid* stays inside it.
- **Seller** and **platform** selects, so "everything I have running on Allegro right now" is one
  filter rather than a walk through parcels.
- **Group by sale** turns the flat list into sections, off by default.

Your choices — including what is in the search box and the **Show closed** toggle — are remembered
per collection and are also in
the address bar, so a filtered view can be bookmarked or shared. The ones that ask a question of
*today's* list — the closing windows, the
first row, **Not described** and **Duplicate** — live in the address bar only: they are jobs you go and do, and
coming back tomorrow to a list still narrowed to them would hide everything actually running.

## Sales — paying for a parcel

**Auctions → Sales** in the sidebar lists the settlements. Its toolbar carries a **search box** —
over the sale's name, its catalogue URL and the seller or platform it is with — and the status
chips; both are remembered per collection and travel in the address bar, exactly as the lot list's
filters do, so coming back to the screen finds it as you left it. Each row shows the parcel's **all-in total**:
every bid you would actually pay for — *open* and *won* lots — plus the premium on each, plus
shipping once. Lots you lost, watched or cancelled cost nothing and are left out of the total. Beside it is the parcel's
**catalogue total** over the same lots, and the headroom between the two — this time with shipping
included, because that is what the parcel actually costs. A parcel priced in another currency shows
its all-in total in your collection's currency too, and its own screen does the same under every
figure on the terms-and-totals card.

**Add lot** on a sale's own screen puts a lot straight into that parcel — no seller, platform or
matching to go through, because the settlement is already the screen you are on. Its closing date
fills the lot's in, and the amounts are in the sale's currency.

A sale's own screen adds two more totals beside its all-in one, the pair the lots screen carries for
the whole watchlist: **committed** — what this parcel costs if every bid you placed on it wins at
your maximum, the won lots at what they fetched, shipping once — and **at ceiling**, the same if you
carry every open lot in it up to your ceiling. The all-in total says what the parcel costs at
today's prices; these two say what it can cost. Lots carrying neither a bid nor a ceiling are named
under the card, because nothing can cost them.

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
  set** — the same choice the [purchase order](purchases.md) intake gives you. A house lot that
  says *Michel 1–12, complete* is one pick: the issue's
  [checklist](collections.md#checklists) expands into one line per stamp on it, all described the
  same way. An issue collected more than one way offers a button per checklist, so the pick names
  which set the lot is. The set is only a shortcut for
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

### "You are already winning this"

While you are describing a lot, the contents are checked against **the lots you are currently
winning** — the ones marked *leading*, plus the ones that have closed with you in front and are
waiting for the result to be confirmed. If the same stamp turns up in both, a note appears above the
lines, naming the other lot so you can jump to it.

There are two weights, and **neither one stops you saving**:

- **The amber warning** — the same stamp, the same condition, the same format. You are on course to
  buy this twice. If the two lots are described with **different certificates**, it still warns, and
  says which the other one carries: an Attest changes what a copy is worth, not which stamp it is.
- **A quiet line of text** — the same stamp at a different condition or a different format. A single
  and a block of four are two different things to own, so this is a remark rather than an alarm.

A stamp entered as a **variant not identified** matches the specific variants underneath it, and the
other way round: *Michel 12, variant unrecorded* and *Michel 12 II* are two ways of tracking one
thing. Two different variants — *12 I* and *12 II* — are two different stamps and never warn about
each other.

Bidding on the same stamp in two lots is a perfectly ordinary thing to do — a better copy turns up
mid-sale, and you want whichever comes cheaper — so the warning is only ever a warning.

Two things it does **not** do. It reads the **contents**, so a lot you have not described yet never
warns, however many times you paste the same listing. And it only looks at lots you are **winning**:
one you have been outbid on costs you nothing to bid on again, and one you lost last year means you
are still looking.

This note only speaks while you are editing contents, which is the moment a duplicate is usually
*made*. For one that came about some other way — the second lot entered last week, a bid that pulled
ahead overnight — the **Duplicate** chip on the lots screen holds the same set standing, and the
[notification centre](action-items.md) reports it as *Winning the same stamp twice*. All three read
the same rule, so they cannot disagree; only the amber-strength collisions reach the chip and the
panel, since a standing filter cannot afford the quieter kind.

### Lines you are looking for

A line whose stamp is on your [want list](wants.md) carries a **crosshair chip**. Click it for every
open want on that stamp.

When the line's own **condition, certificate and format** would satisfy one of those wants, the chip
is **ringed** and the popover marks which want — the sharper question, and the one worth answering
ninety seconds before a lot closes: not "I collect this stamp" but "this is the one I am after".
The judgement is the same one Stamporama makes when the copy actually arrives, so a lot marked as
matching will greet you with that want at intake.

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

The footer of the editor, and the row labelled **headroom** in the worth half of the grid, is the
catalogue value less what the lot actually costs you.

> headroom = catalogue value − (bid + the seller's premium)

The bid it subtracts is the **auction's** — what the lot stands at now, or what it went for once a
result is recorded — not the one you placed and not your ceiling. So it answers: *if this lot went
at what it stands at, how much catalogue value would I be getting above what I pay?*

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
- **Collapse all** / **Expand all** for the cards themselves. Lot cards start **collapsed**: a
  parcel is read as the lots in it, and a lot's composition is a second question. Two lots open
  by themselves — the one you arrived at by clicking a lot on the watchlist (the highlighted
  card), and one added while the screen is open.

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

## What a lot is worth bidding

What a lot is *worth bidding* is a different question from what its contents catalogue at, and the
answer is not one number: it is three — a **floor**, below which the lot is a bargain, the **fair**
figure itself, and a **walk-away**, past which it belongs to somebody else. A single figure would
state a precision this evidence does not have; three state a decision.

The **Recommended** column on the right of each row carries the fair figure, and clicking it opens
everything behind that number. The `REC` button on the ceiling column writes the same figure
straight into your ceiling without opening anything.

### The three figures

All three are **all-in** valuations, like the ceiling itself, and each is shown twice: what the lot
is worth in total, and the **hammer bid to type** to stay inside it. The seller's premium is what
separates the two; shipping is not counted, because a parcel ships once however many lots are in it.

| | What it means |
|---|---|
| **floor** | your bargain percentage of fair — below this you are buying well |
| **fair** | what the lot's contents suggest it is worth |
| **walk-away** | your ceiling percentage of fair — past this it belongs to somebody else |

`fair` is the sum over the lot's lines, and **nothing is added for a complete series or taken off
for a big lot**. Both are real market effects and both are yours to judge — the floor percentage is
where "multi-line lots go cheap" belongs, and the ceiling field stays editable in any case.

**Any of the three can become your ceiling.** Click a level in the panel and it is written there and
the panel closes; the same three are in the row's ⋮ menu as *Ceiling = bargain floor / recommended
bid / walk-away*. Which one to take is a judgement — how badly you want the lot, how thin the
evidence is — which is why the panel is where it is made: the results it is built from are on the
same screen. The row's own `REC` button stays on **fair**, so a row you are only scanning still has
exactly one answer on it.

### Where each line's figure comes from

Every line of the composition is priced **on its own**, because one lot routinely mixes a stamp you
have results for with one you have never seen:

1. **A recorded result**, if any closed lot has ever carried that exact `stamp × condition ×
   certificate × format`. The panel shows the median, how many results are behind it, the span of
   dates they cover, and a **confidence** badge built from sample size, how recent they are, how
   much they agree and how much of the evidence was a whole lot rather than a share of a mixed one.
2. Otherwise **its catalogue value times a learned percentage** — see below. The panel names the
   percentage, the group it was learned from and how many results that group holds.
3. Otherwise **nothing**. The line is counted and named at the foot of the panel, never treated as
   worth zero: a lot half of which cannot be priced must not read as a finished answer.

A line priced in a currency with no rate into the sale's is reported the same way — it has a value
and it cannot be added up, which is a different fact from having none.

The panel also says **how many copies of each line you already hold**. That is evidence and nothing
else: it never moves a figure. Duplicates are bought deliberately, for trade and resale, so an
automatic discount would bid *least* on exactly the material you most want. Whether it changes what
you bid is a judgement, and the panel's job is to put the fact next to it.

Nothing here is stored. The recommendation is worked out each time it is read, so a lot will be
recommended differently a month later once more results have been recorded — that is the price base
having learned something, not a figure going stale. The only number kept is the ceiling you commit
to. A lot with nothing described yet has no recommendation at all.

### The settings

The percentages the band is built from live under **Settings → General → Bid recommendation**, per
collection:

| Setting | Default | What it means |
|---|---|---|
| **Bargain floor** | 75% | The share of the fair figure below which a lot is a bargain. |
| **Walk-away ceiling** | 125% | The share past which you stop bidding. |
| **Catalogue fallback** | 100% | What a catalogue value counts as while nothing has been learned yet. |

Each is a whole percentage. The floor is **not** required to sit below 100 nor the ceiling above it:
buying only well under what a lot is worth is a trading style, and the app has no business calling
it a mistake.

#### Why "percent of catalogue" is not one of these

The obvious fourth setting — *stamps in my areas fetch about 40% of Michel* — is deliberately absent.
That figure is not a preference, it is a measurement, and it is not one number: it moves with the
area, the period and the condition. A 1940s Polish issue and a modern Western European one realize
nothing like the same share of their catalogue value, so a single percentage typed in once would be
a market opinion that is wrong nearly everywhere.

Instead it is **learned from the results you record**. Every closed lot whose contents you described
is a hammer price beside a catalogue value, and their ratio is filed by area, condition and period.
A recommendation uses the most specific group that holds at least three of them, and says which
group it used and how many results are behind it — *"55% — Polska Ludowa, mint never hinged,
1945–1949, from 6 results"* is something you can argue with; *"55%"* is not.

The **catalogue fallback** above is what fills that gap until then, and 100% is chosen so it changes
nothing: before anything has been learned, a catalogue-anchored recommendation is exactly the
catalogue value the `CAT` quick fill already writes. It stops being consulted as soon as there is
evidence.

There is no setting for the percentage itself, and there is deliberately no way to override it: you
would be tuning against evidence the app is showing you on the same screen. If a group's percentage
looks wrong, the answer is another recorded result — which is the strongest reason there is to file
the lots you merely **watched** as well as the ones you won.

## What is not here yet

- Winning **part** of a lot, when a multi-stamp lot is split.
- A screen of its own for what the market has paid. Recorded results feed the
  [recommendation](#what-a-lot-is-worth-bidding), but there is nowhere yet to browse them per stamp.
- Capturing a listing from anywhere but Allegro. Other marketplaces are still typed in by hand.
- Any automatic refreshing of bids. Capturing an Allegro listing again re-reads its price, but only
  when you ask it to — nothing polls a marketplace on your behalf.

A lot's **notes** field is a good place for anything the contents list has no room for — condition
doubts, what to check before bidding.
