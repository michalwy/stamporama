# Dashboard

The **Dashboard** is the screen of work waiting on you across the collection — open it from
**Dashboard** at the very top of the sidebar. Where the [Overview](overview.md) is a picture of the
collection, the Dashboard is a list of what to do next.

It is laid out in five sections side by side across the window:

- **Sales** — sales to chase, pack and send
- **Incoming purchases** — purchases on their way to you
- **Offers to handle** — offers to publish or fix
- **Auctions I bid in** — auctions to bid on or settle
- **Trades** — agreed trades waiting on a parcel

Each section's name is a link to the screen where that work is mostly done, and the figure beside it
is everything waiting in the section. A section that has nothing built into it yet says *No groups
here yet*.

## Groups

Inside a section, the work is split into **groups**. Each group shows how many things are in it and
lists them, oldest or most urgent first. **Every row is a link** to the screen where you deal with
that one thing, and the group's name is a link to its screen filtered to exactly the group. When a
group holds more than ten, the rest is behind *N more →*.

Nothing is done on the Dashboard itself: it shows what is waiting and takes you to where it is
handled.

A group with **nothing in it stays on screen** as a single line with a **0**, so an empty Dashboard
means there is nothing to do — not that something failed to load.

## Sales

The **Sales** section holds the sales you still have to move along:

- **Sold on Allegro, no sale recorded** — listings Allegro reports sold that you have not recorded
  as a sale yet; the same list the bell shows.
- **Awaiting payment** — sales still *Ordered*.
- **To pack** — sales *Paid* and not yet packed.
- **To send** — sales *Packed* and not yet sent.

Each sale shows its number and buyer, its platform, what the buyer pays, and how long it has been in
that status — the longest waiting first. Click it to open the sale. Once you move a sale on, it leaves
its group; sent and received sales are not on the Dashboard. A group's name opens the Sales list
filtered to that status.

## Incoming purchases

Three groups, in the order a parcel goes through them:

- **In transit** — purchase orders marked *In transit*.
- **Arrived, to sort** — orders marked *Arrived* that still have an open lot, and opening balances
  still in progress with an open lot. Once every lot is closed — or the document is marked
  *Completed* — it leaves the group.
- **Scans to cut** — card scans that are uploaded and prepared but have nothing cut from them yet:
  the cards on a purchase's screen that offer *Review the front cut* or *Review the back cut*.

A purchase row shows the supplier (an opening balance's title), the order number, the purchase date
and the value, and **how long it has been in its state** — in transit for how long, or arrived how
long ago. The longest-waiting come first. A scan row shows its batch and the document it belongs to,
and how long ago it was uploaded. Every row opens the purchase.

How long an order has been in its state is counted from the moment its status last changed. Orders
recorded before the Dashboard had this section count from their purchase date until their status
next changes.

*N more →* under **In transit** opens Intake documents filtered to *In transit*. Under **Arrived, to
sort** it opens the list filtered to *Arrived*, which also holds arrived orders whose lots are all
closed and does not hold opening balances. Under **Scans to cut** it opens Intake documents.

## Offers to handle

The offers that need your hand, in five groups. Each row shows the offer's number and title, its
platform, and how long it has been waiting, and opens the offer.

- **Ready to publish** — offers marked *Ready* and not yet put up, the longest-ready first.
- **Pending approval** — offers submitted and waiting for a group administrator (or the platform)
  to approve them, the longest-waiting first.
- **Needs action** — live listings that are wrong: one holding a copy that has sold elsewhere, is in
  another live auction, or has sold on Allegro (these come first), and one whose contents have
  changed since it went up. Each row says which.
- **Quick buys to refresh** — quick buys up longer than their platform's refresh threshold, aged from
  when they were last posted.
- **Auctions ended, no result** — your auctions that have ended with a bid and have no sale or other
  result recorded yet, aged from when they ended.

Offers that were already in Ready or Pending before the Dashboard learned to age them show an
estimate: the day they were created.

## Auctions I bid in

The auctions you bid in, in three groups:

- **Closing soon** — lots still open that close within the day: the last chance to bid.
- **Waiting to be closed** — lots whose closing time has passed with no result recorded.
- **Won, not yet purchased** — lots you won that are not in a purchase yet: still to be paid for and
  settled from their sale.

Each row names the lot, its sale and its seller, and how long until it closes — or how long ago it
did. It opens the lot in its sale, where you refresh a bid, record how it ended or settle the parcel.
The first two groups are the bell's groups of the same names; the third opens the lots screen's
**Won, not yet purchased** filter.

## Trades

Two groups, both of **agreed** trades:

- **To send** — your parcel has not gone out yet. A trade whose partner's parcel has already arrived
  is still here: you still owe yours.
- **Waiting for the partner** — your parcel is out, theirs has not arrived.

Each row names the partner, the trade's number and its balance — pieces each way, or the agreed
figures each way on a trade balanced by value — and how long it has waited: since it was agreed for
*To send*, since your parcel went out for *Waiting for the partner*. A trade agreed before the app
recorded that moment, with nothing on it to tell when, shows no age and is listed first. The longest
waiting come first. A trade with both parcels accounted for is in neither group: what it waits for is
closing.

## The Dashboard and the bell

The [Action items](action-items.md) bell stays as it is: a short list of what has gone wrong or is
about to. Where a Dashboard group means the same thing as a bell group, both read the same list, so
the two never disagree. Scans ready to cut are on the Dashboard and not in the bell: the bell reports
only a scan that could not be prepared.
