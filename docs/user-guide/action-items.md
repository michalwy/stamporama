# Action items

**Action items** is the small bell at the top of the sidebar, beside the collection's name. It carries
a count of everything currently waiting on a decision, and opens a panel listing what — grouped by
kind, with every row linking to the thing it is about.

It reports nothing new. Each group is a state the app already tracks on one of its own screens; the
point of the panel is that you do not have to visit four screens to find out whether any of them
wants something. Nothing is decided here either: a row is a doorway, and every one of them lands on
the screen where the decision belongs, with the record in front of you.

The badge appears only when something is waiting. With nothing outstanding the bell is quiet and the
panel says so.

## Priority: what the colours mean

Groups are graded by **what is at stake**, not by what they are about, and the panel reads worst
first. The bell itself takes the colour of the worst thing waiting — never of the count, so three
ended lots never look more urgent than one copy sold twice.

- **Red — a double sale is possible right now.** The same piece of stock is committed in two places.
  It costs money and a rating, and only you can undo it.
- **Amber — a deadline set by someone else that you can still meet.** Nothing is broken; something
  will be missed if it is left.
- **Blue — bookkeeping that will never fix itself.** Nothing is at risk, but nothing is going to
  remind you again either.

This is the same rule the lot list already follows — colour means *act now*, which is why an ended
lot there is greyed out rather than reddened.

## What it reports

**Closing soon** — amber. [Auction lots](auctions.md) still open that close within the next 24 hours.
The row names the lot and its seller and says how long is left; opening it goes to the lot's sale
with that lot marked, which is where you refresh the bid.

**Waiting to be closed** — blue. Lots still open whose closing time has passed with no result
recorded. This is the one thing on the list that never fixes itself: the lot list deliberately mutes
an ended lot rather than raising an alarm about it, so this is how you find the ones still to be
closed. Closing the lot — confirming what it went for — removes it from the list.

**Winning the same stamp twice** — amber. Two lots you are **winning** hold the same stamp at the
same condition and format, so you are on course to buy it twice. Only lots you are leading on, and
lots that closed with you ahead of the field, are compared — one you have been outbid on costs you
nothing. Bidding on the same stamp deliberately is fine, so this is a warning and not an error:
it goes away when one of the two is no longer yours to win, or when you correct what a lot is
described as holding. Clicking through lands on the lot list's **Duplicate** chip.

**Listing a copy sold elsewhere** — red. An active [offer](offers.md) holding a copy that has already
sold through a different listing. The copy is gone, so the listing is stale on its platform: remove
the dead set or withdraw the listing.

**Conflicting with a live auction** — red. An active offer holding a copy that another of your active
listings currently has *in active bidding*. Two of your own listings are competing for one piece of
stock, and the auction is the one that cannot be taken back.

**Bidding started on Allegro** — blue. An auction of yours that Stamporama itself marked **in active
bidding**, because Allegro reported a bidder ([how that works](allegro.md#bids-on-your-auctions)).
Nothing here is wrong — somebody bidding is the listing working — so it is blue: this is the app
telling you what it did on your behalf, and what the marketplace said when it did. What *is* urgent
about it, the same copies sitting in another live listing, is the red group above.

It is a **notice, not a running tally**: the row is there until you have seen it, and **opening the
offer is how you see it**. Twenty auctions being bid on all week are not twenty rows all week — each
one is announced once. Clicking through therefore does two things at once: it takes you to the offer
and clears the row. The list of everything currently under the hammer, read or unread, is the offers
list's **In bidding** filter, which is where the group's own link goes.

**Auction ended with a bid** — amber. An [auction of yours](offers.md#ended-auctions--waiting-on-you)
whose closing time has passed with a bid on it, and which nothing has resolved. It is the mirror
image of *Waiting to be closed* above: that one is a lot somebody else was selling, this one is a
listing of yours somebody has bought. Record the sale, or mark the listing unsold and relist it; it
is amber rather than blue because until then those copies are still sitting in every other listing
they are in, where they can sell a second time. Longest-closed first, and clicking through lands on
the offers list's **Ended auctions** chip. An auction that ended with nobody bidding is never here —
which is also why a marketplace that relists unsold auctions by itself cannot fill this list up.

**Bid withdrawn, still marked in bidding** — amber, and this one does **not** go away on its own. The
offer is still marked in active bidding while Allegro now reports nobody bidding on it — a bid was
cancelled. That matters because the marker is holding those copies out of every other listing for a
bid that no longer exists. Stamporama never clears the marker by itself, so this waits for you:
open the offer and either leave it (the auction may yet be bid on again) or **Clear active
bidding**.

The two red groups are the same **needs action** flag the offers list shows, split by *why* it fired,
because the two ask for different things: a sold copy has to come out of the listing, while a copy
under the hammer is waiting on someone else's clock. Clicking through to see the rest lands on the
offers list's **Needs action** filter, which holds both.

## Reading the panel

Groups are listed most severe first, each headed in its own colour with a rule down its left edge.
A group shows the few most pressing rows and, when there are more, a **N more →** link to the screen
filtered to exactly that group's set — the same rows, in the same order, with everything the screen
shows about them. A group with nothing in it is not drawn at all.

The count on the bell is the number of rows underneath it. A listing flagged for both reasons is
listed twice, because it carries two problems that need two different answers.

The count and the list update **as soon as you act**: record a lot's outcome, withdraw a listing or
remove a sold set and the group empties immediately, wherever on the app you did it. On top of that
the panel re-reads itself every few minutes and whenever you come back to the tab, so a lot that
moves into its closing day appears without a reload.
