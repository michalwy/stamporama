# Purchases

A **purchase** records one acquisition — a single event where money changed hands. It is
where your **cost** lives: what you paid a dealer, an auction house, or a private seller,
including shipping. A purchase groups together everything bought in that transaction.

Open the **Purchases** screen from the **Buying** section of the sidebar.

## What a purchase holds

On the purchases screen a purchase is just its **header**:

- an optional **supplier** — who you bought from,
- an optional **platform** — the marketplace or intermediary you bought through (e.g.
  Allegro or eBay), separate from the supplier. So a purchase from *Jan Kowalski* via
  *Allegro* records both.
- the **purchase date**,
- a single **transaction currency** for every amount on the purchase,
- a **shipping / shared cost** (spread across the order's lines by price),
- a **delivery status** (*Preparing*, *In transit*, or *Arrived*).

Every amount field — shipping, lot prices, expense prices — accepts either a comma or a period as
the decimal separator, so `12,50` and `12.50` are both fine. You can also type a small sum instead
of a number — `1+2`, `12,50*3`, `(4,20+1,80)/2` — and it is worked out for you when you leave the
field. If the sum doesn't make sense, the text stays as you typed it and the field is rejected like
any other bad amount.

The order's line items are managed separately, during **lot intake**:

- **Lots** — the *inventory* lines. A lot is a priced parcel — a single stamp, a whole
  series, an album, or a whole box you sort over time. You either leave a lot empty until
  you have sorted it or fill it with individual copies straight away.
- **Expenses** — the *non-inventory* lines. Something bought alongside the stamps that is
  not itself stock — a magnifier, a catalogue, a stockbook: a label and a price. An expense
  absorbs its fair share of the shipping cost so it does not inflate the value of the stamps.

So a freshly recorded purchase has no lines at all — you add them during intake, and its
list total grows as you do.

The one exception is a purchase that came from **settling an auction sale**
([Auction sales](auctions.md#settling-a-parcel-into-a-purchase)). That one arrives with a line per
won lot, priced at hammer plus the seller's premium, and with the lots' contents already identified
as copies — you described them to decide the bid, so nothing is entered twice. It carries a link
back to the sale it came from, beside the supplier in the header. From that point it is an ordinary
purchase: the same sorting, the same lot closing, the same cost basis. Deleting it is also how a
settlement is undone — the bidding record stays, only the link goes.

All amounts on a purchase — the shipping cost and, once added, the lots and expenses — are
in the one transaction currency you pick. If that currency differs from your collection's
base currency, the exchange rate as of the purchase date is captured and stored with the
record.

## The purchases list

Each row shows the purchase's **number** (`#7` — see [Quick jump](quick-jump.md)), the
**supplier** (or *No supplier*, with *via …* when a platform is set), the **date**, the delivery **status**, a
short summary of its lines (how many **lots** and **expenses**), and the **total** — the sum
of every lot, every expense, and the shipping cost, shown in the purchase's currency. A
freshly recorded purchase shows *0 lots* until you add its lines during intake.

- **Filter** by delivery status with the *Preparing* / *In transit* / *Arrived* toggles.
- **Sort** by purchase date or by the date the record was added, ascending or descending.

Your filter, sort, and scroll position are kept in the page URL, so you can bookmark or
share a view. The list loads more rows as you scroll.

## Adding a purchase

Click **Add purchase**. The dialog captures only the header:

1. **Supplier** — start typing to search your suppliers and pick one. You don't have to
   pick: if you type a new name and leave it, it is saved as a new supplier when you save
   the purchase (tagged as a seller, so it is offered again next time). The picker only
   suggests suppliers, so platforms and other contacts never clutter it. Leave it blank if
   the seller is unknown.
2. **Platform** — optional; works the same way, scoped to platforms. Type a new name (e.g.
   *Allegro*) and it is saved as a platform on save, or pick an existing one.
3. **Date**, **Currency**, and **Status** — the date defaults to today and the currency to
   your collection's base currency.
4. **Shipping / shared cost** — optional; spread across the order's lines by price.

Save records the purchase. Its lines — the stamps you bought (lots) and any non-inventory
expenses — are added afterwards during intake.

## Editing and deleting

Use the **⋮** menu on a row to **Edit** or **Delete**.

- **Edit** reopens the header dialog. It never touches a purchase's lots or expenses —
  those are managed during intake.
- **Delete** removes the purchase along with any lots and expenses. This cannot be undone.
  Once lots have been resolved into copies (during intake), a purchase whose lots still hold
  copies cannot be deleted until those copies are detached.

## Intake and the lot lifecycle

Click a purchase row (or **Open** in its **⋮** menu) to open its **detail** screen. This is
where you build up the order's lots and identify copies into them over time.

The header carries a **status** dropdown (top-right). Switch between **Preparing** and **In
transit** and it saves immediately — no need to open the edit dialog. Choosing **Arrived**
opens the **Mark arrived** flow (see *Marking an order arrived* below) rather than a bare
status change, because arriving also moves the order's copies to *To sort*.

Next to the dropdown, a small **→** button advances the status one step along the fixed
progression (*Preparing → In transit → Arrived*) with a single click. It disappears once the
order has **Arrived**.

### Lots

There are two ways to add a lot:

- **Add lot** creates an empty priced inventory line straight away; you then identify copies
  into it over time (see *Identifying stamps* below). Best when you know a lot exists but
  haven't sorted its contents yet.
- **Add lot with stamps** works the other way round: you pick a **stamp or a whole issue**
  first, set its **condition / certificate / location** (with the same optional in-location
  ref and, for a single stamp, photos as ordinary intake — see *Identifying stamps* below),
  then give the new lot its **title
  and price** — the lot is created together with those copies in one step. Best when a lot is
  a single identified item (or issue). Nothing is created until the final step, so backing
  out beforehand leaves no empty lot behind.

A lot can carry an optional **title** (e.g.
*Album Polska 1950s* or *Box lot*) so you can tell lots apart. Leave the title blank and the
lot is labelled automatically from its copies' **catalog numbers** (with the usual vendor
prefixes) — up to three, with *+N more* beyond that — falling back to *Lot 1*, *Lot 2*, …
while it is still empty. Each lot shows:

- its **title** (or the derived label),
- its **price** (in the purchase's transaction currency),
- its **status** — **Open** while you are still identifying copies, **Closed** once its cost
  has been allocated,
- how many **copies** have been identified into it,
- its **pool** — the lot's price plus its fair share of the shipping cost — shown in the
  transaction currency and, when a rate is known, in your base currency. The pool is what
  gets split across the lot's copies when you close it.

A lot's **⋮** menu lets you **Edit lot** (title and price), **Close** or **Reopen** it, or
**Delete** it. Deleting a lot also deletes **all of its copies** — they exist only to
populate the lot, so they are removed with it (you are warned how many when confirming). A
lot's price can only be edited while it is open.

**Catalog value vs. cost.** The whole-order summary at the top of the page, and each lot's
expanded copies, show the same two-line **catalog value / purchase cost** bar as the
[inventory holdings summary](inventory.md) — the summed catalog value (in your base currency,
using each copy's default display condition) next to what was actually paid, so you can compare
paid-against-catalog at a glance. Both lines call out copies that don't fully count: *unpriced*
copies (no catalog price for their condition) and *pending* cost (a copy whose lot is still
open, so its cost-basis is not frozen yet). The order-level bar totals every copy across all
lots; each lot's bar totals just that lot.

**Spent vs. realized.** Once a copy in view has been **sold** ([Sales](sales.md)), three more rows
appear on that same bar — under a rule, because the rows above are what these copies are *worth* and
the rows below what they have *made*. Both levels answer it for their own copies: the order-level
bar for the whole parcel, each lot's bar for that lot alone.

- **Realized** — the sale proceeds of the sold copies, *net*: after the platform's commission, plus
  what the buyer paid towards postage, minus what the shipping actually cost you, all in your base
  currency. Beside it, how many copies in scope have sold — *3 of 10 copies sold*.
- **Net return** — realized minus everything spent on those copies, with a percentage. The spend is
  named on the row, since it is the purchase cost *and* any write-offs together: money spent on a
  copy you have since lost was still spent. (Copies that never arrived are left out of every figure
  here — they cost nothing and can never sell.) This is the *has this parcel paid for itself yet*
  figure, so it stays negative until enough has sold.
- **On sold** — realized minus what those *sold* copies cost, with a percentage. The other question:
  how the sales themselves went, regardless of how much is still unsold. Both are shown because
  neither answers the other.

The figures are live, not final: they move as more sells. Where a sale's copies came from several
different purchases — or from two different lots of one purchase — each copy's share of that sale is
worked out from its catalog price, the same split the sale itself uses. If a copy on such a shared
sale has no catalog price, its share cannot be worked out at all: it is still counted as sold, and
the bar says so (*1 not attributable here*) rather than quietly counting it as nothing.

### Card scans

Instead of photographing each stamp as you identify it, you can **scan a whole stockbook card
at once** and cut the scan into per-stamp **tiles**. Each stamp is then handled physically once
— laid out and scanned — and everything after that happens on screen.

Open an order and use **Add card scan** in its **Card scans** section, above the lots.

**A card belongs to the whole order, not to one of its lots.** That is what the section sits at the
order level for. A stockbook you bought as one lot is scanned onto one or two cards and reads exactly
as you would expect; but twenty single stamps won at one auction become twenty lots on one purchase,
and they still arrive in one envelope and still go onto one or two cards. So the batch numbers run
across the parcel — *Batch 1, 2, 3*, once each — and a tile from any card can become a copy on any of
the order's lots. Which lot a stamp belongs to is a question you answer when you identify it, which
is the first moment you can.

You can also give a card a **name** — see below.

#### Laying out the card

Lay the stamps on a **black** stockbook card and scan the whole card square-on. The app finds the
pieces on the card by separating them from that black background, so the layout is what decides how
much correcting is left to do. Two things about it matter:

- **Leave about one perforation tooth of gap between stamps.** Where two stamps abut teeth into
  teeth, the seam is white paper against white paper: there is nothing there to find, so the two
  will come out as one box and you will have to split them by hand. This is the single biggest
  difference between a card that cuts cleanly and one that does not, and no amount of tuning can
  cross it — it is the one thing the detection cannot be made to see. A tooth of gap is enough; the
  stamps do not have to be spread out.
- **Anything joined stays joined.** A se-tenant pair, a block, a strip: it is one piece, so it is
  one box, one tile and — once identified — **one copy with a format**, never several singles.
  That is correct, not a limitation to work around.

Scan at a decent resolution: the scan is cut **before** anything is downscaled, so a card scanned
at 600 dpi gives each stamp its own full-size image rather than a soft fragment of a shrunken
sheet.

The card itself can stay as it is — a black card with the creases and weave of one that has been
used is what the detection was fitted on. What it does need is an **even** black: a shadow falling
across one half of the card, or a lamp on one side of it, is the case most likely to confuse it.

#### While the scan is uploading

A 1200 dpi card is a large file — 100 to 200 MB is ordinary — so the upload says how it is going,
and it does so in **two stages that mean different things**:

- **Uploading the scan…**, with a bar and a percentage. That is real: it counts the pieces of the
  file the app has actually taken, not what your browser has handed to the network.
- **Preparing the scan…**, with no percentage. The bytes are all in; what is happening now is the
  app opening a very large image and making the working copy the cut editor draws. It takes a few
  seconds and there is nothing to measure, so it says so rather than showing a number that would
  sit still. **Seeing this means the upload has succeeded.**

The scan is sent in pieces, which is what makes a card this size possible at all — most self-hosted
setups sit behind something that refuses a single upload that large. It also means a hiccup costs
you a piece and not the whole card: a dropped request is retried on its own. If the connection
gives up entirely you are told, and nothing half-sent is left behind.

Cancel by leaving the page; a scan that never finished arriving is cleaned up on its own.

#### Naming a card

Beside **Add card scan** there is an optional **name**: type one and it rides with the card you are
adding. Leave it blank and the card takes **the name of the file you upload**, without its extension
— *Klaser Polska 1.jpg* becomes *Klaser Polska 1* — since that is usually the naming you already did
at the scanner. (A file name too long to fit leaves the card unnamed rather than failing the upload.)
You can also name a card at any time afterwards — click the name (or *Name this card*) on the
batch's own line — which is usually when you want to, since a card often turns out to need naming
only once a parcel has been left half worked for a week and the thumbnails are the only clue.

The **number stays**, and it stays first: it is assigned rather than chosen, and it is what makes a
batch findable. The name sits beside it — *Batch 3 · Klaser Polska 1* — so two cards you both called
*Polska* are still tellable apart. Clearing the field un-names the card.

The name shows wherever the batch is named, including the one line a worked-through batch collapses
to, which is where it earns its keep.

#### Cutting the scan

The scan opens in the **cut editor**, over the card itself, with **the stamps already boxed**. That
proposal is where a cut starts, not where it ends: look down the card, correct what is wrong, and
draw anything that was missed. On a card laid out with a tooth of gap between the stamps that is
usually a box or two.

Two mistakes are worth looking for by name, because they are the ones the detection makes:

- **Two stamps in one box** — they were touching. Select the box and **Split** it.
- **One stamp in two boxes** — usually a stamp with an attached coupon or label, where the gap
  between the two halves is a real perforated separation. Select both and **Merge** them.

A slip of paper laid on the card, or the corner of an envelope a stamp is still on, is boxed like
anything else. That is deliberate: the piece of paper *is* the piece, and if it is not one, deleting
its box costs a click, whereas a stamp quietly dropped from a card that has already been broken up
is one nothing on screen would tell you about.

Every edit below works the same whether the box was proposed or drawn by hand:

- **Drag** on an empty part of the card to draw a box.
- **Click** a box to select it; **shift-click** to add to the selection; drag inside it to move it,
  or drag a corner or edge grip to resize it.
- **Delete** (or Backspace) removes the selected boxes — a shadow, a fibre, the card's own edge.
- **Merge** turns two or more selected boxes into the single rectangle holding them all, for a
  stamp that ended up halved.
- **Split ↔** and **Split ↕** cut one selected box into two: press the button, then click where
  the seam is. The guide line turns red where the cut would leave a sliver, and such a cut is
  refused rather than made.

Each box carries the number it will be created with — rows top to bottom, each row left to right.
**Nothing is created until you press Cut**, so the whole review is free to be wrong. Cancel and
the scan is still stored, waiting to be cut.

**Clear all** empties the card if the proposal is more trouble than it is worth, and a scan the
detection could not read simply opens on an empty card — drawing every box by hand is always
available, and always works the same way.

#### Looking closer

The cut is worth checking at a size where you can see it, because the mistake that matters most is
the quietest one: a box clipping a stamp's perforation by a few pixels. On a whole card at once that
is invisible.

- **Wheel** over the card zooms, towards wherever the pointer is — put it on the corner you are
  suspicious of and turn. `+` and `−` do the same from the toolbar or the keyboard.
- **Hold space and drag**, or drag with the **middle mouse button**, to move around while zoomed.
- **Fit** (`0`) puts the whole card back on screen. It is where the editor starts, and where a
  resized window returns to unless you have zoomed.
- **1:1** shows one screen pixel per pixel of the scan itself — the size a crop is actually taken
  at, and the honest answer to "is this box in the right place".

Drawing, moving, resizing, splitting and merging all work the same at any zoom, and zooming changes
nothing about the boxes themselves: they are stored against the scan, not against what is on screen.

Past 1:1 of the display copy the editor fetches the part of the card you are looking at from the
**full-resolution scan** — the percentage in the toolbar picks up a dot when it is showing that.
Otherwise zooming in would only magnify the display copy, which for a high-resolution scan is a
larger blur rather than more stamp. There is a short pause after you stop moving before the sharper
image arrives; the card stays on screen throughout.

#### Backs

To capture backs, **turn each stamp over in place** — do not lift the group or rearrange it — and
scan the card again. Then use **Add back scan** on the batch and cut it the same way.

Backs are matched to fronts **by position**, not by order: each back goes to the front sitting in
the same spot, and the match has to agree both ways. Nothing is mirrored, because turning each
stamp in place is what keeps the positions lined up in the first place.

If the two sides do not have the same number of boxes, that is reported rather than hidden — *Front
12, back 11*, naming which fronts found no back. It usually means a stamp fell out, two were drawn
as one, or the wrong file was uploaded.

A back that finds no front appears in an **unpaired backs** strip below the tiles. Drag it onto the
tile it belongs to. That is also how you handle a card where you only scanned backs for some of the
stamps, or where the layout was not reproduced.

#### Re-cutting

The scan itself is **kept**. If the cut was wrong — and a stockbook that has been broken up cannot
be scanned again — press **Re-cut**: the batch's tiles are thrown away and the editor reopens over
the same card, **with the previous boxes still on it**, so a bad cut is a box moved rather than a
card redrawn.

**Delete batch** removes the tiles *and* the scans. Re-cut is almost always what you want instead.

Deleting one of the order's **lots** leaves the cards alone: they belong to the parcel, and the other
lots still have pieces on them. A tile that had already become a copy on that lot keeps its square
and says the copy was deleted. Deleting the whole **order** is what takes the scans.

Re-cutting is **refused once a tile has become a copy**: that copy holds the tile's very images, so
throwing the tile away would take the copy's front and back with it. Discarded tiles have no such
protection — the card is being drawn again, discards included — so the confirmation tells you how
many discards and notes are about to go with them.

#### Working through the tiles

Click a tile. **The picture is the dialog**: the tile fills it, with the answer beside it. A crop
that took half a stamp or a piece nobody could identify is visible at this size and nowhere else —
the intake step that follows never shows the images — which is the whole reason for reviewing tiles
rather than trusting the cut.

**Zoom it instead of reaching for a loupe.** The tile zooms and pans exactly as the cut editor does:
the wheel zooms to the pointer, dragging moves the picture, <kbd>+</kbd> / <kbd>−</kbd> and
<kbd>0</kbd> do the same from the keyboard, and **Fit** and **1:1** are in the toolbar. That is the
point of scanning at 1200 dpi in the first place: the perforation teeth, the watermark and the plate
flaw you would settle a variant by are already in the picture, so telling two variants apart is a
pass at the keyboard rather than one at the desk.

**1:1 means one screen pixel per pixel of the scan** — past it you are enlarging, not seeing more.
For a single stamp the tile's own image *is* the whole scan of it; for something larger than the
image cap — a block, a long strip — the part you are looking at is fetched from the **full-resolution
card scan**, and the percentage picks up a dot while it is showing that. Once a card's scans have
been swept by the retention setting there is nothing deeper to fetch, and the tile's own image is
what you see; by then the card has been worked through and the close look is over.

**Switching front to back keeps the zoom and the position.** Telling a variant apart is a
comparison, so flipping sides leaves you looking at the same part of the stamp at the same
magnification rather than starting again from Fit.

#### Measuring on the scan

Many variants differ by a measurement — the perforation, the size of the design, the gap between two
elements — and the scan already holds it. Two tools in the same toolbar read it out, so a
perforation question is settled on screen instead of with an odontometer.

**Ruler** — drag from one point to another and read the distance in millimetres.

**Perforation** — drag from the **first hole of a run to the last** and read the gauge. That is how a
physical odontometer works: perforation is quoted as teeth per 2 cm. You are told **both figures** —
the nearest catalogue step (11¼, 11½, 11¾…) and the measurement it came from. The step is what a
catalogue prints and what you will compare against; the raw figure is what tells you whether the
piece sits comfortably on that step or awkwardly between two, which is usually the interesting case.

**The teeth between your marks are counted for you.** When you let go of the drag, Stamporama reads
the edge you marked and fills the count, and the field goes blue with a small **counted** tag beside
it. It is a reading, not a fact: **look at it against the picture**, and if it is wrong just type
over it — the tag disappears and your number is used.

When it cannot count them it says which of the three things went wrong, next to the field, rather
than filling in a guess: *too short to count* (mark a longer run), *couldn&apos;t find a perforation
here* (the marks are not on an edge, or it is too ragged to read), or *couldn&apos;t read the
picture* (the image could not be fetched). In every one of those the number is yours to type, which is
how it worked before it could count at all.

Redrawing the line counts again, so a run that read badly is re-read by dragging it once more.

While a tool is down, **drag places the marks** and holding <kbd>space</kbd> — or the middle mouse
button — moves the picture instead. The reading appears **at the end of the line as you drag**, so a
run is adjusted while watching the figure rather than by dragging, looking down at the bar and
dragging again; it stays there when you let go, and the bar underneath keeps it too, along with the
resolution and the tooth count. <kbd>Esc</kbd> takes the marks off, and again puts the tool away.
Marks belong to the side they were placed on, so flipping front to back clears them; the zoom is
kept as always.

**Say what you scan at — the app never guesses.** Every reading is shown with the resolution it was
taken at (*11½ (11.63) at 1200 dpi*), and the field it came from sits right beside it. It is filled
in from **Settings → General → Scanner resolution**, so on the scanner you always use it is already
right. A scan's file can claim a resolution it does not actually have — usually left over from an
earlier edit — so nothing is read out of it: perf 11½ and perf 12 are less than 4% apart, and a
number taken at the wrong scale looks exactly as convincing as a right one.

If one particular card came off a different scanner, **change the figure in the bar** and the reading
updates. That change lasts for as long as you are looking; it does **not** become the collection's
setting, so measuring one old card at 600 dpi cannot quietly change what every later measurement
assumes. Changing that for good is a Settings act.

**Zoom in before you mark.** The reading is taken on the scan's own pixels however far out you are,
but below **1:1** you are placing the marks to within more than one of those pixels — the toolbar
line says so while that is the case.

**Nothing is written down.** A measurement is a reading you take and use; it is not saved on the
copy or the stamp. What you concluded from it belongs on the stamp you identify the piece as, or in
the note of a piece you set aside. A tile with no cut box behind it — nothing in the ordinary scan
flow — has no tools at all, because there is then no way to know what its pixels measure.

**Every tile opens the same dialog, whatever state it is in, and no tile takes you off this screen
when you click it.** One waiting to be dealt with opens on its three answers; a discarded one opens
on its note; one that has already become a copy opens on the copy it became. Leaving the purchase is
always something you ask for — a card of forty is worked through in one sitting, and getting back
means finding the purchase and the batch again.

The dialog **opens on the likely answer rather than asking which one you want**, and the other two
are always one click away in its footer. It opens on *assign* when the order holds a copy that could
still take **this tile's** images, and on *identify* when it does not — so a settled auction order
starts on its list of lines, the same order starts on identify once they are all photographed, and a
stockbook order with a couple of hand-entered copies offers them. There are three answers:

- **Identify as a new copy** — the stockbook path. It leads into the same browse popup and condition
  step as [Add stamps](#identifying-stamps-intake), with the same remembered choices, and the tile's
  images move onto the copy it creates. There is no photo uploader in that step, because the pictures
  are already in hand. A whole-set button is not offered either: a tile is one piece.

  If the order has more than one open lot, that step also asks **which lot** the copy belongs to —
  the question a card cannot answer, because one card routinely holds pieces from several. Your last
  answer leads, since a card, or a run of them, is usually worked through before you start the next.
  With a single lot nothing is asked at all.
- **Assign to a copy on this order** — the auction path. An order settled from an
  [auction sale](auctions.md#settling-a-parcel-into-a-purchase) already holds identified copies,
  because the contents had to be described in order to bid. Those copies need *photographs*, not
  identification, so you pick from the order's own short list — matching pictures against known
  stamps rather than identifying from scratch — and the list spans **every lot won**, which is the
  point: they all came out of the same envelope and went onto the same card. Only copies that can
  actually take **this** tile are listed: a tile with a front goes onto a copy that has no front, and
  one with both sides onto a copy with neither. If a copy you know is on the order is missing from the
  list, it already has the side this tile carries — the line above the list says which that is, and
  each row says what the copy already holds. This stays available for a copy on a **closed** lot:
  closing froze the money, not the photographs. Nothing is asked about lots here; the copy has one.
- **Set aside to check** — the piece you cannot tell apart from its picture: a watermark, two shades
  of the same blue, a paper difference. Press it and a field opens **right where the button was**,
  asking what to check: type *watermark?*, *dark or light blue?*, *check perf against Mi 200* and
  press **Enter**. That sentence is the point — in a month you would otherwise be deriving the doubt
  again from the very picture that could not settle it — which is why you are asked for it while it
  is fresh, rather than left to find a box for it afterwards. It is still optional: Enter on an empty
  field sets the tile aside anyway, because *something is off here* is a complete thought. **Escape**
  backs out of the question without touching the tile. The tile is then **still to be identified** —
  it has not become anything and it has not gone away — it has only left the queue until you have
  the answer, so working through the rest of the card stops offering you the one piece you cannot
  finish at this desk. When you know the answer, identify it as usual from the same dialog (the note
  is at the top of it, and you can change it there); or **Put back in the queue** if it turns out
  there was nothing to check. Before you press it — or afterwards — you can list **what the piece
  could be**, so the narrowing you have already done is there when you come back; see
  [Pieces you cannot identify from the picture](#pieces-you-cannot-identify-from-the-picture).
- **Discard** — junk, damaged beyond interest, unidentifiable. One click, and it asks for nothing:
  on a parcel full of junk this is the frequent answer, and it is safe to make it that cheap because
  it is reversible — **Put back in the queue** is in the same dialog. The tile **keeps its image**,
  stops counting as unidentified so it no longer nags before you close, and survives the lot
  closing. For a stockbook bought sight-unseen these tiles are the only record of what was actually
  inside; a discard is evidence, not a dismissal.

**Duplicates you can see on the card: tick them and identify them together.** Fifteen of a
definitive is an ordinary find in a stockbook, and walking each one through the browse popup and the
condition step is fifteen passes over a decision you took once. Every tile still waiting has a small
**tick box in its top-right corner**; tick the ones that are the same stamp in the same condition and
a bar appears above the batches saying how many are selected. The batch header has a box of its own
that ticks every tile still waiting on that card, showing a dash while only some of them are.

Ticking changes nothing about clicking: the rest of the square still opens the tile's dialog, and a
tile you have already dealt with has no box, having reached its end.

**Identify N tiles as one stamp** takes you through the same two steps as one tile — pick the stamp,
then answer the condition step once — and creates **one copy per tile**. Everything the step asks
applies to all of them: one stamp, one condition, one certificate, one format, one lot, one location,
one disposition. The count is stated before anything is created: on the bar, in the summary box at
the top of the condition step, and on the confirm button.

**Each copy keeps its own picture.** These are fifteen photographs of fifteen pieces of paper, not
fifteen copies of one image — each tile's own crops go onto its own copy, exactly as they do when you
identify one at a time. The copies are numbered in the order the pieces are laid out on the card.

**Ticking tiles is you saying they are the same.** The app takes your word for it: it does not check
the assertion and it does not offer to find duplicates for you, because telling two shades or two
perforations apart is the work you are doing here, not something to guess from a thumbnail. What it
does do is put **all of the pieces on screen beside the form**, small, for the whole of the
identification — which is how you catch a stamp that does not belong in the run *before* it becomes
fifteen copies rather than after. Click any one of them to look at it at full resolution in the usual
viewer, and use the *← All N pieces* button to come back.

**Step along the run without going back to the grid.** With one piece open, the *‹* and *›* buttons —
or the <kbd>←</kbd> and <kbd>→</kbd> keys — move to the piece before or after it on the card, with
*n / N* between them saying where you are. That is how a run is compared: flick from one piece to the
next at the same magnification and the odd one out shows itself. It does not wrap around, so the
button goes dead when you reach the first or the last piece.

If one of the tiles turns out to have been dealt with meanwhile — in another tab, or from its own
dialog — the whole pass is refused and **nothing is created**, so you can untick it and go again.

**Duplicates you meet as you go: *Same as the last*.** Once you have identified one tile in this sitting, the dialog
offers to identify the next one the same way — and it **names what it will repeat**, so the button
reads *Same as the last: Mi·PL 200, MNH* rather than asking you to remember. Duplicates on a card sit
next to each other, and working a batch in order means meeting them in a run.

It is the companion of ticking, not a lesser version of it: tick the tiles when you can see the run
on the strip before you start, and repeat when you only discover the duplicate on reaching it.

It is the *stamp* that this saves you. Everything else the condition step asks — condition,
certificate, location and its ref, disposition, the lot — already comes back on its own from the last
copy you took in; the stamp deliberately does not, because the next tile is normally a different one.
So the whole of "the same again" is *and the same stamp*, and it is worth a button rather than a walk
through the browse popup.

It **fills the step and stops at the ordinary confirm**. Nothing is created by the press itself: you
see what is about to be made, with the picture of this tile beside it, and press **Identify the tile**
as usual — a consumed tile has no undo short of deleting the copy it became. What it fills is the
**previous tile's** answers rather than your usual defaults, which is the point: the two differ
exactly when you have changed something for this card. **Back** takes you to the browse popup and
drops the repeat, so the stamp you pick instead arrives at your ordinary defaults.

The **catalogue value** field is the one thing it does not fill, and does not need to: that figure is
a fact about the stamp, so the field already shows what you recorded for this stamp in this condition
the first time round.

**The piece stays on screen for the whole of identifying it.** Choosing *Identify as a new copy*
used to leave the picture behind on this dialog: the browse popup, any issue or stamp you created
inside it, and the condition step that followed all showed nothing of the tile, so *used or mint?*
was answered from memory — forty times per card. Now the tile comes with you. It is the **same
viewer** you have here, beside each of those dialogs rather than above them: wheel or `+`/`−` to
zoom, drag to move, `0` to fit, `1:1` for the scan's own pixels, and **Front / Back** where the
batch has both — which is half of what condition is judged on, gum and hinge marks being on the
back. Each step opens fitted to its own panel; the zoom you set is kept across a front/back flip,
as it is here.

It appears **only where there is a picture of that piece** — which means the scan-tile path and
nothing else. Adding stamps by hand shows no picture at all, and deliberately does not fall back to
the stamp's catalogue photo: that is a picture of *a* specimen of the stamp, not the one in your
tweezers, and beside a condition field it would invite reading a condition off the wrong stamp.

A **note** on a discard is optional and written afterwards: click the discarded tile again and the
same dialog has the field. Worth doing on the piece whose reason you will not remember in a month
(*thinned*, *faked overprint*), and worth skipping on the forty that were simply junk.

**A tile that became a copy says which one.** Click it and the dialog shows its pictures — the very
images the copy now owns — the copy's number, the stamp it was identified as and its condition,
which is enough to check it against the piece in your tweezers without going anywhere. **Open copy**
in the footer takes you to it when you want it, and being a real link it opens in a new tab on
ctrl/cmd+click, so you can look at the copy and keep the card you are working. If the copy was
deleted later, the dialog says so: the images went with it, and the tile stays as the record that it
was worked through.

**Worked tiles stay where they are.** The strip is a map of the card on your desk — tile 7 on screen
is the seventh piece on the stockbook — so nothing disappears or shuffles up as you go, which is what
lets you keep matching a tile to the piece in your tweezers.

**The tiles still waiting are the ones that stand out.** A tile nobody has dealt with wears a
coloured edge; a tile you have finished with lets its picture step back and takes a small mark in
its top corner saying what became of it — a **tick** for one that became a copy, a **crossed circle**
for one you discarded, a **pause mark** for one you set aside to check. The mark sits over the scan
rather than being a shade of it, so it reads the same on a pale stamp as on a dark one, and the ends
never look like more and less of the same thing: one piece became something, one deliberately became
nothing, and one is still to be identified. A tile set aside keeps its picture at full strength and
its own coloured edge, because it is still work — only not work for right now. The label underneath
still gives the copy number, which is what you read when you want the detail rather than the glance.

#### Pieces you cannot identify from the picture

Some variants are not settled on a screen at all. A watermark needs the tray or the lamp, two shades
of one blue need the colour key, a paper difference needs the reference album. Settling one the
moment it turns up means getting up from the desk once per stamp — which costs far more than the
identification it serves.

So **set it aside to check** and carry on. The value is not the mark on the tile; it is that the set
aside pieces **collect**: ten cards of one parcel at three doubtful pieces each is thirty, and thirty
is a sitting. You make the trip to the colour key once.

They gather on the order itself. The Card scans header grows a second chip beside *N tiles
unidentified* — **N to check** — and pressing it narrows the strips to exactly those pieces, across
every card of the parcel, each one still in its own card's strip and its own position on it, which is
what tells you which card to pull out of the tray. Each batch's summary line counts them apart too:
*12 waiting · 3 to check*. Both are work you still have; only one of them is work you can do now.

Sitting down with the lamp, click any of them: the note you left is the first thing in the dialog,
and the identification is right underneath it — a set-aside tile is identified exactly like any
other, with no un-parking step in front of it. It also still has its **tick box**, which is the point:
five pieces that turn out to be the same variant are settled in one pass, and the sitting where you
finally tell them apart is precisely the sitting where that happens.

**Write down what it could be — before you set it aside.** Finding out that a piece cannot be
identified from its picture is not free: to know that a watermark or a shade is what decides it, you
have already worked out which stamps it could be. Every tile still to be identified carries a line
for exactly that — **Cannot tell? List what it could be…** — which opens the same browse popup you
identify from, with the piece beside it. That popup **stays open**: pick the two or three stamps it
could be one after another (they appear beside the picture as you go), then close it and press **Set
aside to check**. You never have to come back into the tile to write the list down.

Each stamp you add becomes a row on the tile — the picker's own row, with its picture, its catalogue
numbers, its price and how many copies you already hold, which is what you actually compare a piece
against under the lamp. Coming back, pressing one **identifies the tile as that stamp**, going on to
the usual condition step and its confirm; the × beside it rules a possibility out when the lamp
settles it. Nothing is forced: **Identify as a new copy** is where it always was, one click away, for
the piece that turns out to be neither of the stamps you shortlisted it to. The list also shows under
the tile on the strip, which is what makes a sitting plannable — five pieces narrowed to the same
pair is one comparison, not five.

**Often you do not need to set the piece aside at all, and the app will say so.** If everything on
your list is a variant of one stamp — *it is Mi 200, but is it watermark A or B?* — then Stamporama
already has a better answer than a tile in a tray: identify it as **Mi 200** itself. The copy is
created, marked *variant not yet known*, valued cautiously, given its number and its place in the
box, and [**Identify variant**](inventory.md#identifying-a-variant) settles it whenever you get to
the lamp — with the change recorded on the copy. A line offers exactly that, once and quietly: under
the list, and again in the *what to check* box the moment you press **Set aside to check** — which is
the better moment to read it, since it is cheaper not to put the piece in the tray than to take it
out again. It changes nothing on its own: the piece stays where you put it until you press it. It
appears only for
true variants; a shortlist of *the base stamp or its overprint* is a different question — there the
base stamp is one of the answers — so nothing is suggested. That is what candidates are for:
possibilities that are not variants of one another, two different issues, or a base stamp you have
not settled yet.

Once the tile becomes a copy the list is gone, and so is the note: what the copy **is** is the
record from then on, and a change of mind later is written in the copy's own refinement history
rather than in a shortlist standing beside it. Putting a piece back in the queue clears both for the
same reason — the doubt is spent. A **discard** keeps them, since a discarded tile is the only
record of what a sight-unseen parcel held.

**A card with a piece set aside on it is not finished with**, and the app treats it that way
throughout: the batch stays in the live list rather than being put away, it is never marked done, and
if you have switched on the scan-retention setting below, its card scan is **not** swept — which
matters more than it sounds, since that scan is exactly what you came back to the piece for.

The close dialog names them too. A tile you set aside has deliberately left the *unidentified* count,
so nothing nags about it — and the moment before you freeze a lot's money is the one place it has to
be put in front of you again.

#### Batches you have finished with

A card whose tiles have all been dealt with is **set aside**. The Card scans section then shows only
the batches with work left in them, above a line reading *12 worked-through batches — show*. Press
it and they come back, each folded up into its own header line: its number, how many tiles it held,
how many became copies, how many you discarded, and the day you finished it. Open any of them with
the caret and every tile it ever held is still there, in the positions they had on the card.

Nothing is ever deleted. A strip is the record of a card that came into the house, and for a
stockbook bought sight-unseen the discarded tiles on it are the only record of what was inside — so
a worked batch is put away, never thrown away, and the count above the list is always the way back
to it. That is also why the count sits on the section itself: with every finished batch put away
there would be no batch header left to hang it on.

**The record is never deleted. The scan behind it can be, if you ask.** A finished batch's card scan
is the largest file this app keeps, and once every tile on the card has been dealt with the card can
never be cut again — so **Settings → General** has *Keep card scans of finished batches*, which will
delete those scans after a period you choose. It is **off unless you switch it on**: a listing's
generated images can be made again, but a stockbook taken apart cannot be scanned again, so nothing
here is deleted on a schedule you did not ask for. If you do switch it on, the batch keeps its tiles,
its copies, its discards and their notes; its line adds **scan deleted**, and **Re-cut** stops being
offered, because there is no longer a card to draw on.

Which batches are open is worked out from the work itself, not remembered as a setting: **a batch
with tiles still waiting shows, and opens, by itself**, the same way a lot you add while the screen
is open opens by itself. Put a discarded tile back in the queue and its batch has something waiting
again, so it comes back to the list on its own; a batch with a piece set aside to check never left. Finish the last tile on a card and it goes the other
way — the strip leaves the list and the count above it goes up by one.

**Batches are never reordered.** Batch order is the order the cards came in, and the pile on your
desk is in that order too — moving the unfinished ones to the top would break the one thing the
numbering is for. Revealed batches come back **in place**, among the live ones, not gathered at the
end.

Either chip on the section's own header — **N tiles unidentified** or **N to check** — does the same
hiding for its own reason, so while one is pressed the count is not offered: one question should not
have two controls that can disagree.

The picture on a consumed tile is the copy's own front photograph — the same image, which moved to
the copy rather than being duplicated, so you will see it again on the copy's row below. The only
tile drawn empty is one whose copy you later **deleted**: its images went with the copy, and the tile
says so rather than showing a broken square.

The **N tiles unidentified** chip on the Card scans header is also a filter — press it to show only
the tiles still waiting, and the section opens if it was collapsed. It counts the whole **order's**
tiles, because that is what a card holds: pieces belonging to any of its lots.

**A tile that matches no auction line is worth knowing about.** If an order came from a settled sale
and a tile turns out to be a stamp none of its lines described, the Card scans section says so. That
is not an error to correct: together with a line marked *not delivered*, it is exactly how the app
tells you the parcel differed from what you bid on.

#### Tiles and closing a lot

A tile is not a copy: it has no stamp, no catalogue price and no share of any lot's cost. The Card
scans header shows **N tiles unidentified** for the order and the close dialog repeats it — along
with how many pieces you have set aside to check, which nothing else nags you about — but
closing is never blocked by tiles — the cost split is correct without them. The dialog mentions them
because any of those tiles could still become a copy on the lot you are about to close. They survive
the close, discarded ones included.

### Identifying stamps (intake)

A large lot is rarely sorted in one sitting — you identify stamps into it as you work through
the parcel, often long after the money changed hands. Click the lot's **＋ Add stamps** button
(in its header, while the lot is open). This opens the same **browse popup** used across the
app: navigate areas and issues, and either

- pick a **single stamp** (creating the issue/stamp first if needed), or
- add a **whole set** with the button on the issue row — one per
  [checklist](collections.md#checklists) the issue carries, named after it, creating a copy for
  every stamp on that checklist. An issue with a single checklist keeps the familiar
  **+ Whole issue** label.

Expanding an issue whose stamps you want to pick one by one gives you the same **Checklist**
filter the issues list has, so a series collected two ways can be narrowed to the set you are
actually buying. The stamp rows read exactly as they do on the Stamps and Issues lists, the
**copies-held badge** and the **want marker** included, so you can see what you already have
before you even pick.

You are then asked once for the **condition**, an optional **certificate**, an optional
**storage location** — with an optional **in-location ref** (e.g. a page or pocket like
`A234`) once a location is chosen — and an optional **disposition**. Disposition shows the
three flags (**In collection / For sale / For trade**) as chips you click to toggle on the
spot; they preset where each created copy is headed and can be combined. All of these apply to
every copy created in that step. Your last choices — disposition included — are remembered and
pre-filled for the next stamp, so sorting a parcel into the same box, condition, and
disposition is quick. When you are adding a **single stamp** you can also **attach
photos** to that copy right here (front/back plus extra images); a whole-issue intake creates
several distinct copies, so photos are offered only for single-stamp intake.

There is **no picture of the stamp** on this step when you are adding stamps by hand, and that is on
purpose rather than missing: the app has no photograph of the piece in your tweezers, and the
stamp's catalogue photo is a picture of a different specimen. Identifying a
[scan tile](#working-through-the-tiles) is the case where a picture of the actual piece exists, and
there it stays on screen beside every question.

If your collection defines [formats](inventory.md#pairs-blocks-and-other-multiples) — pairs,
blocks, strips — a
**Format** field sits beside the condition, defaulting to **Single**. A se-tenant pair or a block
of four is one collectible rather than several, and the moment you identify it is the moment you
know which it is; recording it here saves editing each copy afterwards, from memory, once the
sorting pass is over. It is offered for **single-stamp** intake only, the same rule photos follow
and for a stronger reason: a whole-set intake creates copies of many different stamps, and one
format could not be true of all of them. Collections with no formats defined never see the field.

Unlike the choices beside it, the format is **not remembered** — it starts at *Single* every time.
That is deliberate. A stockbook card is often all mint or all used, so remembering the condition
saves hundreds of clicks; multiples do not come in runs like that. If the format stuck, the one
block of four you enter would quietly mark every single after it as a block too, and a format you
never chose is much harder to spot than a missing one, which at least reads as *Single*.

#### The catalogue value, while the catalogue is still open

Underneath the condition row there is one optional **Catalog value** field. Identifying a stamp is
the one moment you already have the paper catalogue open at that very stamp, so entering the figure
costs you a field; entering it a month later means finding the stamp again, on paper and in the app,
from a list of hundreds. It is also what stops the `N unpriced` chip and the refusal to
[close a lot](#closing-a-lot) from ever coming up: both exist because prices are usually entered
long after identification.

- **One field, your primary catalogue only**, on its latest edition — the line beside the input
  names it, with the currency. The full [Set catalog value](#closing-a-lot) dialog, which prices
  every catalogue active on the area, is still on each copy's row for when you want the rest.
- **Optional, always.** Blank is the ordinary case, and nothing ever waits on it.
- If a value is **already recorded** for that stamp at the condition, certificate and format you
  have chosen, it is shown in the field and editing it replaces it — you never end up with two.
- **The figure belongs to the condition you typed it for.** Change the condition, the certificate or
  the format afterwards and the field re-reads for the new one — which may already have a value of
  its own. A figure you had typed and not yet saved is not carried across, and the field says so
  rather than just emptying itself.
- The field waits for a condition to be chosen, since the value is recorded against the pair.
- Collections whose area has no catalogue with an edition never see the field.

The value is saved when you confirm the step. If saving it fails, nothing else happens either and
the message says why — a figure you read off the catalogue is not dropped quietly.

The copies are
linked to the lot and marked **Ordered** — purchased but
not yet in hand, so they are deliberately **not** counted as *in collection* yet. (They
become part of your collection later, once received.) If the order is already **Arrived**
— the usual case when you identify a parcel piece by piece on your desk — the copies start
at **To sort** instead: they are in hand, just not filed yet, so they land beside the
siblings that **Mark arrived** already moved there. Either way they are not *in collection*
until sorted.

**What you already hold.** When you pick a **single stamp**, the dialog names it and adds one line
underneath saying what the collection already has of it — for example
*You hold 2: 1 in collection (MNH) · 1 for sale (U)* — or *You hold none of this yet.* Working
through a stockbook bought sight-unseen raises the same question on every piece (is this needed for
the collection, or is it stock?), and the line answers it without a trip to Inventory and back. The
**conditions** are listed because the count alone settles nothing: two copies mean something quite
different if they are both used. They are *listed*, never ranked — Stamporama nowhere decides that
one condition is better than another (`U` and `MNG` are cancellation and gum, not two points on one
scale) — so the judgement stays yours, and the disposition chips are not touched by any of it: your
remembered choice still stands, because only you know that this whole stockbook is stock. A **whole
set** intake has no single stamp to report on, so the line is offered for single-stamp intake only —
the same rule photos follow.

*You hold* means **copies that have arrived and been sorted**. Copies you have bought but not yet
received are counted too — they are bought, and forgetting them is how you buy the same stamp twice
— but they are said **separately**, after the headline and with their own conditions:

- *You hold none · 1 on its way (MNH)* — a stamp won at auction and still in the post. This is the
  case worth spelling out: the copy is recorded, so a plain count would say *you hold 1* while you
  stand there with the only physical copy of it in your tweezers.
- *You hold 1: 1 in collection (MNH) · 1 being sorted (U)* — *being sorted* is a copy that has
  arrived and is not filed yet, which is both the other parcel on your desk and the piece you
  entered from this very stockbook ten minutes ago. Neither *held* nor *coming*, so it is neither.

Those clauses carry no disposition, because a copy that has not arrived has not been filed anywhere
yet, and they do not say which order a copy belongs to — the useful fact is where it is. The line
counts the **same copies** as the copies-held badge on the catalogue lists (sold copies, copies you
no longer hold and copies that never arrived are left out of both); what differs is that the badge
gives one number and this line splits it, because *hold* is a claim and the badge is a count.

**The want marker.** The same line carries the **crosshair chip** when the stamp is on your
[want list](wants.md), ringed once the condition, certificate and format you have picked would
satisfy one of the wants — all three are axes a want is matched on, so a block of four does not ring
for a want that only ever wanted singles — and it moves as you fill the form. Click it for the terms. The chip is on a lot's copy
rows too, and it is the same judgement the intake review below makes, so a ringed pick is one the
review will greet you with.

**Wants these copies could satisfy.** If any of the copies you just took in matches an open
entry on your [want list](wants.md), Stamporama shows it right after the intake and lets you
**close** the want, **narrow** it (the common case: the want was "anything", a used copy
arrived, so it becomes "any mint"), or **leave it open**. Nothing is closed automatically —
holding a copy is not the same as having what you wanted. Dismissing the dialog changes
nothing.

While the lot is **open**, each copy shows a **live estimated cost-basis** (prefixed with
`~`) — the share of the lot's pool it would receive if you closed the lot right now, computed
from the current copies and their catalog prices. It updates as you add, remove, or price
copies, and is **not** saved; the real cost-basis is frozen only when the lot closes. A copy
with no catalog price (or a purchase with no base-currency rate) shows `cost —` until that is
resolved. The estimate is always computed over the **whole lot**, so it stays accurate no
matter how many copies the lot holds or how far you have scrolled.

**Large lots.** A lot's copies **stream in as you scroll** — the list loads more rows when you
reach the bottom, and the header counts (*to sort*, *unpriced*, *no photos*, the copy total) and the live
estimate are figured over the whole lot on the server. There is no cap: a "stockbook" lot with
thousands of positions shows every copy, and ticking a whole lot or a whole issue group means
**every copy the list is showing** — resolved on the server, not just the rows you have loaded.

**The lots toolbar.** One row above the lots carries everything about how they are shown and how
new ones are made: the **Lots** heading, **Group by**, **Sort copies**, **Expand all**, and — at the
right-hand end — **Add lot** and **Add lot with stamps**.

**Grouping the copies view.** On that row, a **Group by** control has two toggles —
**Lot** and **Issue** — that shape how the whole order's copies are shown:

- **Lot + Issue** (the default) — each lot is a card, its copies grouped by issue inside.
- **Lot** only — each lot is a card with a flat copy list.
- **Issue** only — no lot cards; every copy in the order grouped by issue **across all lots**.
- **neither** — a single **flat list** of every copy in the order, with no lot boundaries.

**Sorting the copies.** A **Sort copies** control next to *Group by* orders the stamps *within*
each lot by **Order added** (the default), **Year**, **Catalog no.**, **Price**, or **Name**,
with an **↑ Asc / ↓ Desc** toggle to flip the direction. It sorts the copies inside a lot (and
inside each issue group, and in the flat / by-issue copy views) — not the lot cards themselves.
Copies missing the chosen field (no year, no catalog number, an uncertain value, no name) always
sort last. Catalog numbers sort naturally (1, 2, 10 — not 1, 10, 2).

Your choice is remembered per collection, and which issue groups you've collapsed is
remembered too, so the view stays the way you left it. In a grouped-by-issue view each issue
appears as a header that reads like a row on the Issues screen (area, title, catalog numbers,
required/total stamp count) and can be collapsed or expanded. **Lot cards themselves start
collapsed** — an order is read as the lots in it, and a lot's copies are a second question. Open
one with its **caret**, or the toolbar's **Expand all** (which becomes **Collapse all** once they
all are). A lot you add while the screen is open opens by itself. **Lot management** (add stamps,
edit price, close/reopen, delete) lives only in a **by-lot** view. Sorting is not lot management,
so **Store** and **Move to location** work in every view — the issue-only and flat views are for
sweeping through copies and sorting them, and that is exactly what those two acts are for.

**How close a series is to a complete set for sale.** In a grouped-by-issue view, each issue
header also carries one figure per [checklist](collections.md#checklists) the issue has — the
answer to *can I list this series as one set yet?*:

- **6/6 — complete** — you hold a for-sale copy of every stamp on that checklist.
- **12/30 · 18 missing** — you do not, and eighteen is how many more you need.

The chip carries the figures and nothing else. **Which** stamps are missing is in the hover:
one chip per stamp, in the order you arranged the issue's stamps in, which is the list you take
to the next card. They are not on the chip itself, however short the gap — a header already
carries an area, a title, catalogue numbers and a stamp count, and three numbers out of eighteen
were never enough to act on anyway.

It opens on **hover**, where the [want marker](wants.md) on a catalogue row takes a click. That is
the content deciding, not an inconsistency: this is a short list of numbers you only read, and while
sorting you run down group after group — a click each, and a popover each to dismiss, would slow the
one screen where speed is the point.

The fraction and the missing stamps both range over your **whole for-sale stock** — every
for-sale copy in hand, wherever it is filed, not just the ones in this lot. That is deliberate:
a figure scoped to the lot would report *5/6* about a series whose sixth copy has been in a box
for six months and send you looking for a stamp you already own. Beside it, in muted text,
**· 4 from here** says how many of those came out of *this* lot (or, in the issue-only view,
this order) — which is what tells a series being built out of this parcel, where the last one
may still surface from the copies you have not sorted, from one that was finished months ago.
Hovering the figure spells the range out.

Two things do **not** count towards it. A copy still **ordered** or **in transit** is bought,
and every other count in the app includes it — but a set one copy of which is in the post
cannot go out, so this figure waits for it to arrive (**to sort** already counts: the stamp is
on the desk). And a copy that is not marked **For sale** does not count either, however many of
them you hold: a keeper is not stock. Copies that have sold, or that you have written off, are
out for the same reason.

An issue with several checklists reports each one **separately**, named — a stamp that two sets
share is counted for both, because *is the basic set complete?* and *is the specialized set
complete?* are two questions and one merged figure would answer neither.

Each copy's **⋮** menu also offers **Edit copy** (condition, certificate, storage,
disposition) and **Edit stamp** (the underlying stamp, including its catalog prices on the
**Prices** tab) — so you can correct a copy or fill in a missing price without leaving the
lot.

To remove a stamp from a lot, use its **⋮** menu → **Remove from lot**. Because these copies
exist only to populate the lot, removing one **deletes** it.

### Attaching a copy that already exists

Intake *creates* copies. Sometimes the copy is already there — you entered a piece by hand
before recording the receipt, or you filed one under the wrong order. Use the lot's **⋮** menu →
**Attach existing copies…**.

The dialog is the same picker used elsewhere: areas and years down the left, a searchable list
of copies on the right, tick the ones you want. Attaching changes the copy's **purchase link and
nothing else** — its condition, storage, delivery status, dispositions, photos and
[internal number](inventory.md#internal-copy-number) all stay exactly as they were. A copy
already in hand does **not** go back to *Ordered* because you recorded its cost late.

Two rules follow from cost-basis being frozen when a lot closes:

- **The lot you are attaching to must be open.** A closed lot has already split its pool across
  the copies it held; a copy added afterwards would not be in that split.
- **A copy sitting in a closed lot is not offered.** Moving it out would leave the copies that
  stayed in that lot under-costed. Reopen the source lot first, then attach.

A copy that belongs to **another open purchase** *is* offered, but never moved quietly: the
dialog names the order it would be taken off and asks you to confirm the move before the
**Attach** button becomes available.

### The delivery lifecycle: ordered → to sort → delivered

Each copy carries a **delivery status** shown as a chip on its row, separate from its
disposition (in collection / for sale / for trade). A purchased copy moves through:

- **Ordered** — added during intake to an order that has not arrived yet; bought but not yet
  in hand, so it is **not** in your collection yet.
- **To sort** — the order arrived but this copy still needs sorting; still **not** in the
  collection. Intake into an **Arrived** order starts its copies here.
- **Delivered** — sorted and filed; now counted **in your collection**.

with **Not delivered / missing** and **Damaged** as outcomes you may discover while sorting.

While a lot is open, each copy's delivery-status chip is a dropdown, and a small **→** button
beside it advances the copy one step along the happy path (*ordered → in transit → to sort →
delivered*) with a single click. The button is hidden once the copy is **Delivered** and on
the exception outcomes.

### Marking an order arrived

When the parcel lands, open the purchase and click **Mark arrived** (top-right of the
header). This flips the order's status to **Arrived**, moves every **Ordered** copy to **To
sort**, and — optionally — files the whole order into one location in a single step (e.g. an
*Incoming box*), so nothing is loose while you work through it. You refine each copy's real
location later, during sorting.

### Sorting copies

Sorting is where **To sort** copies become **Delivered** (in your collection). Work at
whatever granularity suits the parcel — everything works the same way: **tick what you mean, then
use the bar that appears at the top of the order** (see
[Two acts](#two-acts-store-and-move)). There are three checkboxes and they behave alike —

- **A whole lot** — the checkbox in its header, which works on a **collapsed** card too.
- **A whole issue** — the checkbox on the issue header, in any **By issue** view.
- **A batch you pick yourself** — the checkbox on each copy's row.

A container's box shows a **dash** when only part of it is ticked, and unticking something
underneath one simply leaves it out. Ticking a lot or an issue means every copy in it, including
the ones further down the list that have not loaded yet — and when a filter chip is on, it means
every copy **that chip is showing** (pressing the chip afterwards releases that tick, since it no
longer describes what you are looking at).

There is **one selection for the whole order and one bar**, above the lots. A batch on your desk
does not respect lot boundaries — copies from three lots go onto one transport card in one act —
so the selection spans lots, and the bar is pressed once rather than once per card. Changing
**Group by** or the sort order is a change of view and leaves what you picked standing.

You can also edit **a single copy** right on its row: its **delivery chip** is a dropdown for
setting the status (Ordered, In transit, To sort, Delivered, …) with a **→** button beside it
to advance one step, and its **disposition** shows all three flags — **In collection / For
sale / For trade** — as chips you click to toggle instantly (no expand or confirm step). Its
**location chip** (or the **📍 Set location** button when it has none) opens the location
tree-select. For condition or certificate changes use its **⋮** menu → **Edit copy** — e.g.
if the seller shipped a different condition than expected (MH instead of MNH), correct it
there.

To focus on what's left, click the lot header's **N to sort** chip to filter the list down to
just the copies waiting to be sorted; click it again (or the **To sort only ✕** button) to show
all. As you sort each copy it drops out of the filtered list. The chip counts copies in the
**to sort** state only — copies still *ordered* or *in transit* haven't arrived yet, so there
is nothing to sort about them (the close confirmation still counts those; see
[Closing a lot](#closing-a-lot)).

The lot header also carries a **N no photos** chip whenever some of the lot's copies have no
[photo](inventory.md#photos) attached — click it to filter the list down to just those copies
so you can see what still needs photographing, and click it again (or **No photos only ✕**) to
show all. Unlike the *to sort* and *unpriced* chips, this one stays available after the lot is
closed, since photographing usually happens once the stamps are in hand.

When you put copies into a **location** (storing, moving, or setting one copy's), the picker
remembers the last location you used and pre-selects it, so working box after box is one click.
New copies can still be identified into a lot at any time while it is open — handy for a mixed
album bought sight-unseen.

If a copy turns out to be a **different variant** than expected, its **⋮** menu →
**Identify variant** re-points it to the right one (available when the copy is linked to a
base stamp with variants).

### Two acts: Store and Move

Once something is ticked, a bar appears above the list with the two things you can do to it.
They are two, and deliberately not one dialog with a *mark them sorted* checkbox: relocating a
card and declaring a batch worked through are different claims, and a checkbox nobody notices
would quietly make the second one for you.

**Store** puts copies away — where they now live, the ref card they sit on, what they are being
kept for, and **delivered**, in one act. It asks for:

- a **location** — *Leave as is* or one you pick, pre-filled with the last one you used;
- a **ref** — optional, and only once a location is chosen (a ref numbers a card *inside* a
  location, so there is nowhere to put one otherwise);
- a **disposition** — *Leave as is* (the default), or **In collection / For sale / For trade**.

Leaving the location alone is the ordinary path for a batch you already filed **copy by copy**
during the pass: it declares them sorted without overwriting where each of them was put. The
disposition's *Leave as is* works the same way, and is different from turning all three chips
off, which *clears* the dispositions. Copies already sorted, damaged, or not delivered keep
their delivery status — anything else you set still applies to them.

**Move to location** changes where copies live and claims nothing else: no disposition, no
delivery status. That is the act of filing a parcel into an incoming box on arrival, or
shifting a card between boxes months later. Its location is **required** — the change of
address *is* the act.

Ticked copies survive the filter chips and scrolling, so you can narrow to **N to sort**, tick
your way down the list, and clear the chip without losing what you picked. The bar also offers
**Select the whole order** — every copy of it still in an open lot, which is how you reach
everything from the flat copy list, where there is no heading to tick. Press **Clear** to start
again.

Copies in a **closed** lot get no checkbox anywhere: they are read-only until you reopen it.

#### The ref

The ref is the identifier written on the **ref card** that goes with the stamps: one small
card usually covers a whole transport card's worth, with a per-series card whenever a set
should come out in one grab. It is suggested as **the next free ref in that location** — never
per lot, because the box is shared across every purchase — so storing continues the strip the
box is already on. A location nothing has ever been ref'd in suggests nothing and stays blank,
which is the normal case for an album or stockbook: there the location *is* the address.

Typing a ref that is **already in use** is not an error. Cards get topped up over several
sittings, so the dialog says *"A147 already holds 12 copies"* and the button reads **Add to
A147** — which also catches the typo, since an unexpected collision reads differently from an
expected one.

Blank cards are printed **before** you pack — see
[Printing blank ref cards](locations.md#printing-blank-ref-cards).

### Closing a lot

When a lot is fully sorted, **Close lot** runs the cost allocation: the lot's pool is
distributed across its copies in proportion to each copy's **primary-catalog price** for its
condition (and certificate), and each copy's share is **frozen** as its cost-basis. Closing
works even if the shipment has not physically arrived yet.

If any copies are still unsorted (ordered / to sort / in transit), the confirm dialog **warns
you** — but you can still close (sorting first is just recommended, not required). This warning
is deliberately wider than the header's **N to sort** chip: a lot whose copies are all still
*ordered* has not been through the sort pass either.

Closing is **blocked** if any copy lacks a primary-catalog price for its condition — there is
no weight to split the pool by. The screen highlights the copies that need a price and shows
how many are unpriced; click the **⚠ N unpriced** chip to filter the list down to just those
copies. To price them without leaving the screen, click the **+ catalog value** link in the
copy's catalog-value column — a small dialog sets those values (latest edition) for the copy's
condition × certificate. It shows **one field per catalog vendor active on the stamp's area**,
with the **primary catalog's** field focused first for fast entry; the other vendors' fields are
optional, so you can price several catalogs in one pass or leave any blank to skip it. Saving
requires at least one value. The dialog also shows the stamp's issue, catalog numbers (the
primary catalog's number highlighted), the condition it applies to (shown as a badge), area, and
this **copy's photos** (click a thumbnail to open the lightbox, with prev/next and Esc to close),
plus any prices already recorded for it (across editions, conditions, and certificates) so you
can price consistently — the target rows are marked with an arrow. Closing still only requires a
**primary-catalog** price. (For fuller edits, a copy's **⋮** menu → **Edit stamp** opens the
**Prices** tab.) Then try the close again.

The way to meet this blocker least often is not to reach it: the intake step has its own
[**Catalog value** field](#the-catalogue-value-while-the-catalogue-is-still-open), filled in while
the paper catalogue is still open at the stamp. A copy priced there is never among the unpriced.

### Reopening for corrections

**Reopen lot** flips a closed lot back to open and returns every copy's cost-basis to
pending, so you can add, remove, or re-price copies. Close it again to re-run the allocation
with the corrected membership.

Cost-basis is **frozen at close** and is not recomputed automatically afterwards. If you later
correct a copy's variant or condition, or edit a catalog price, a closed lot's snapshots stay
as they were — reopen and re-close the lot if you want them recalculated.
