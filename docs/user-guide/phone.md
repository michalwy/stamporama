# Stamporama on a phone

Stamporama has a small set of **phone screens** for when you are away from the desk — at a stamp fair,
at a dealer's table, or handling the day's sales. They are part of the same Stamporama you use at the
desk: the same address, the same account and password, the same collection. There is nothing to
install from a store.

Every other screen stays as it is at the desk. Opening one on a phone shows the desk's screen, not a
phone version of it.

## What you need first: one HTTPS address

The phone reaches your own Stamporama server over the internet, so the server needs **one HTTPS
address that works from outside your home** — `https://stamps.example.com`, not a local
`http://192.168.…` address — and you use **that same address on the desk and on the phone**.

It has to be the same one because a sign-in belongs to an address: moving between two addresses, or
between `http` and `https`, signs you out (see [Authentication](authentication.md#staying-signed-in)).
Setting the address up is part of installing Stamporama — a reverse proxy or a tunnel in front of the
server, with the address set as `BETTER_AUTH_URL` — and Stamporama itself adds nothing for it.

## Adding the icon to your phone's home screen

On an Android phone, in Chrome:

1. Open your Stamporama address and sign in.
2. Open Chrome's menu (**⋮**) and choose **Add to home screen** — on some versions it is **Install
   app** — and confirm.

A **Stamporama** icon appears on the home screen. Tapping it opens the phone start screen in a window
of its own, without Chrome's address bar.

## The phone start screen

The icon opens straight into your collection. If you have **several collections**, it lists them
first; tap the one to open, and **Other collections** at the bottom of a collection's start screen
brings the list back.

The start screen lists the phone screens, one row each — **Browse by area**, **Start a purchase**,
**Sales to do** and **Offers**. New ones arrive with new releases. Above
them is the search for a stamp.

## Finding a stamp

The field at the top of the start screen finds a stamp by what you have in front of you:

- a **catalog number**, in any spacing — `Mi PL 200`, `MiPL200` or just `200`;
- the stamp's **name**, or the name of its issue;
- the stamp's **own number**, as its row shows it — `#901` (or `st 901`, as in **Jump to…**).

It is the same search the desk's stamp pickers and **Find in Stamporama** use, so it finds what they
find. Type and press the search key.

Each stamp found is one row: its name (or its catalog number when it has none), its catalog numbers
and its own number, where it sits — area, issue year and name — and two marks you read without
opening it:

- **3 held**, or **Not held** — the copies you hold of it. Copies filed under its variants are counted
  beside it (*2 under its variants*), so a stamp you hold only as variants does not read as missing.
- **Wanted** — the stamp is on your wants, with the priority when it is high or low.

Tap a row to open the stamp's phone screen. When nothing matches, the screen says so. The search
shows up to 20 stamps; when it is full, typing more narrows it.

## Starting a purchase

**Start a purchase** records something you have just bought — at a fair, at a club meeting — while it
is still in your bag. You finish it at the desk, as any other purchase.

- **Bought from** — the seller. As you type, the phone suggests your sellers; a name that is not one
  of your contacts yet is saved as a new seller.
- **Amount paid** and its **currency** — the currency starts at your collection's base currency.
- **Date** — today unless you change it; it cannot be after today.
- **What it was** — optional: *Stockbook Poland 1950s*, *Box of covers*.
- **Stamps bought** — optional. Find a stamp with the same search as the start screen, and tap it to
  add it; each row says whether you hold it and whether it is wanted, so you can see a gap filled
  before you pay. **×** takes one off again.
- **Photos** — optional. **Take a photo** opens the phone's camera; take a picture of what you bought
  as a whole — the stockbook, the set, the box — so you can tell this purchase from the others when
  it reaches the desk. Each photo is uploaded as soon as it is taken, and **×** takes one off before
  you save. Take as many as you like.

**Start the purchase** saves it and shows it back: the seller, the number and date, what was paid,
what it was, its photos and the stamps you noted, with the mark *Started on the phone — to complete*.
**Take another photo** there adds one more to the purchase straight away, and a tap on a photo opens it
at full size. **Start another purchase** goes straight to a new one; **Full app** opens it at the desk,
where photos are also removed.

Photos of single stamps are still taken at the desk, during intake. The phone makes no copies and splits no costs. What it saves is an ordinary purchase marked
*Arrived*, with one open lot at the amount paid, named by what it was — at the desk you take the stamps
in, split the lot or add more, and close it as usual. See
[Purchases started on the phone](purchases.md#purchases-started-on-the-phone).

## Sales to do

**Sales to do** lists the sales waiting for their next step, in the same three groups as the
Dashboard's Sales section — **Awaiting payment**, **To pack** and **To send** — the one that has
waited longest in its group first. Each row shows the sale's number, the buyer, the platform and what
the buyer pays.

Each row has one button that moves the sale a step on — **Mark paid**, **Mark packed** or **Mark
sent**. The sale then shows on the desk exactly as if you had moved it there, status history
included. On the way, the phone asks what the desk would ask:

- **Mark packed** (and **Mark sent**) on a sale whose copies are not all marked as packed asks what to
  do: mark them all packed and move on, move on and leave them, or do nothing.
- **Mark sent** on a sale with no tracking number yet asks for the **carrier** — the one its shipping
  service suggests comes pre-selected — and the **tracking number**. **Skip** marks it sent without a
  number; you can add one on the sale at the desk later.

**Mark paid** asks nothing on the phone: the total the buyer paid, which the desk offers to record at
that moment, is entered at the desk. Everything else on a sale — its lines, amounts, shipping and
corrections to its status — stays at the desk; **Full app** opens the Sales list.

## Offers

**Offers** on the start screen lists your offers, newest first. Two selects at the top narrow it:

- **Platform** — one platform, or all of them.
- **State** — one state, or **Not closed**, which is every offer that is neither sold nor withdrawn,
  as the desk's offers list shows by default.

Each row shows the offer's title, its number, platform, state and price. Tap it to open the offer.

The offer screen shows its picture, title, price, platform and state. The picture is the first
listing image — what a buyer sees first; until those images are generated, it is the photo of the
first copy in the offer that has one.

Below are the moves you can make on the phone, each only where the desk would allow it:

- **Sell…** an active, paused or pending offer that still has something to sell — at a fair, or on a
  Facebook quick buy, the moment it is agreed. Enter the **buyer** — pick one of your contacts as you
  type, or type a new name, which becomes a new contact; leave it blank for a buyer you do not know —
  and the **price**, which starts at the offer's own. On a Facebook offer the buyer is named by their
  Facebook profile, as at the desk: their name as the profile shows it and, optionally, the link, and
  the form says whether that is someone you already know. **Record sale** records a new sale dated
  today on the offer's platform, exactly as the desk's **Sell** → **Create new sale** would, and
  takes you to **Sales to do**, where it waits for payment.

  An offer of several identical sets (a quantity of 3, say) is sold **one set at a time**. When others
  are left, the sale says *Set not chosen*: which copy goes is chosen at the desk, when packing, from
  the sale. The offer is sold once its last set is.

  Everything else about the sale — buyer handling, commission, shipping, adding it to a sale already
  open — is done at the desk, on the sale itself.
- **Pause** an active offer, and **Resume** a paused one.
- **Withdraw…** any offer that is not sold or withdrawn. It asks first, with the desk's own warning:
  withdrawn is final. A lot of a Facebook post still waiting for approval takes the whole post back
  with it, as at the desk.

These change the offer in Stamporama only — pausing or ending the listing on the platform itself is
done there, as from the desk. Preparing, publishing and editing an offer stay at the desk: **Full
app** opens the same offer there.

### A Facebook group auction

While a Facebook group auction is up, its offer screen has a **Bidding** part above the moves, as the
offer's Facebook card has at the desk. It says when the auction closes, and the highest bid you have
recorded with when you recorded it — *recorded 3 hours ago* — or that none is recorded yet. Type the
highest bid you see under the post and tap **Record bid**: it is the same as recording it at the
desk, which shows it exactly as if you had typed it there.

Once the closing time has passed, the part says the auction has closed and the button reads **Record
winning bid** — type the winning figure if it is not the last one you recorded. Then close the
auction from the same screen:

- **Sell…** to the winner, named by their Facebook profile. The price starts at the bid you
  recorded.
- **Withdraw…** when nobody bid.

See [Facebook](facebook.md#when-an-auction-ends) for what each of these does.

## Browse by area

**Browse by area** finds a stamp when you do not know its catalogue number, by where and when it was
issued: area, then year, then issue, then the stamp.

1. The first screen lists your top-level areas, each with how many issues are filed under it, its
   sub-areas included.
2. Tapping an area shows its **sub-areas**, which go further down the tree the same way, and the
   **years** of the issues filed in that area itself, oldest first; issues with no year are under
   **No year** at the end.
3. Tapping a year lists that year's issues in the area, with how many stamps each has.
4. Tapping an issue lists its stamps in the issue's own order, each variant drawn under the stamp it
   varies. Each stamp shows its catalogue numbers, its name (or its denomination and colour), and at a
   glance **how many copies you hold** — or *Not held* — and **Wanted** when it is on your open wants,
   in the colour of the most urgent want. Copies held under its variants are counted beside it.
5. Tapping a stamp opens its phone screen (below).

A level with nothing in it says so plainly — an area with no sub-areas and no issues, a year with no
issues, an issue with no stamps. Browsing only reads; areas, issues and stamps are set up at the desk.
**Full app** opens the desk's area tree, the Issues list narrowed to the area (and year), or the issue
itself.

## A stamp on the phone

Each stamp has a phone screen that answers, on one screen read top to bottom, what you want to know
with the stamp in your hand:

- **The picture** — the stamp's own photos, the first at the screen's width. A stamp with no photo of
  its own shows the photos of your copies of it, and says so; with neither, it says *No picture*.
  Tap a photo to see it at full size.
- **Copies** — how many you hold, then each copy: its condition and certificate (and the format, for
  a pair or a block), where it is kept, and whether it is in the collection, for sale or for trade.
  Copies held under the stamp's variants, and copies that might be this stamp, are counted on their
  own lines, as on the desk.
- **Wants** — whether the stamp is on your wants, and what each want would accept: condition,
  certificate and format, as the want list states them. A closed want is shown faded.
- **Market value** — what the market paid, per condition and certificate: the median of the auction
  results recorded for this stamp, with how many there are and how far to trust the figure. It is
  the figure the desk's Valuation window shows.
- **Catalogue value** — the stamp's catalogue price as the stamp's page shows it, and the
  cross-catalogue average per condition and certificate, in your collection's currency.

Every part that has nothing to show says so — *No copies held*, *Not on your wants*, *No market
value* — so an empty answer is never a gap. The screen only reads: nothing on it changes anything.
**The stamp's full page**, at the bottom, and **Full app** at the top open the stamp's page on the
desk.

[Finding a stamp](#finding-a-stamp) on the start screen opens this screen, and so will browsing by
area, year and issue.

## Between the phone and the full app

There is no automatic switch by device — you choose:

- **Full app**, at the top of every phone screen, opens the desk's screen for the same thing (or the
  collection's start, when there is no direct match).
- **Phone screens**, at the bottom of the sidebar on every desk screen, opens the phone start screen.

## Staying signed in

The phone stays signed in exactly as the desk does: until you sign out, or until 400 days pass
without opening Stamporama at all. The home-screen icon shares its sign-in with Chrome on the same
phone, so signing in once in either is enough. If the phone is signed out, the icon shows the sign-in
screen, and signing in takes you back to the phone start screen.

## No connection

The phone screens always work **online**, against your server. Without a connection a phone screen
cannot load, and Chrome says so; nothing is kept on the phone to work from offline.
