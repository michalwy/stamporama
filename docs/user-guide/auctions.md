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

| | **Auction** | **Mine** | **Ceiling** |
|---|---|---|---|
| **bid** | what the lot stands at | what you placed | the most you could bid |
| **all-in** | what that would cost | what yours would cost | the most it is worth to you |

The **bid** line is hammer prices, the **all-in** line adds the seller's premium. Each pair has one
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
shipping once. A lost lot costs nothing and is left out of the total.

**Add lot** on a sale's own screen puts a lot straight into that parcel — no seller, platform or
matching to go through, because the settlement is already the screen you are on. Its closing date
fills the lot's in, and the amounts are in the sale's currency.

A sale's own screen shows its terms and its lots, and is where you:

- rename it (`Köhler 385`), set its **catalogue URL** and its **closing date**,
- correct the **currency**, **premium** and **shipping** for this parcel,
- **close** it when nothing was won — only an *open* sale is offered when you add the next lot for
  that seller.

Its lots carry the same two rows of chips the flat list has — *can still bid*, *outbid*, *over
ceiling* and the rest, then the recorded outcomes — asked of this one parcel. Only what the parcel
actually holds is offered, and the choice is not carried between visits: it is a working filter, not
a view.

**New sale** on the sales screen is for the auction-house case, where the sale is known up front and
you add lots into it. You never need it for a marketplace basket; that one is created for you by the
first lot.

A sale can only be deleted once it holds no lots — deleting a parcel must not quietly take the
bidding record with it.

## What is not here yet

- **What a lot contains** (the stamps, conditions and quantities) and its catalogue value.
- **Settling a won sale** into a purchase, and recording what a lost lot fetched.
- Capturing a listing straight from the browser.

Until then, a lot's **notes** field is a good place for anything you would otherwise write down
about it.
