# Sales

A **sale** records that one or more of your [offers](offers.md) sold. A sale happens on a single
platform, in a single currency, on one date — the date the exchange rate is frozen at, so
profit/loss is measured against a fixed rate. The **currency comes from the platform**, the same
one its offers use, so an offer and its sale always agree.

Open the **Sales** screen from the **Selling** section of the sidebar.

## Recording a sale

Recording a sale works like [purchases](purchases.md): you create a short **header** first, then
add what sold on the sale's own detail screen.

If the sale happened on **Allegro** and your account is connected, you do not have to type any of
it: **Marketplaces → Allegro** lists the orders waiting to be recorded, and **Record sale from
order** opens this same form pre-filled from the order — buyer, order number, what was paid,
delivery method and the sold sets. You still review and save it yourself. See the
[Allegro guide](allegro.md#recording-the-sale-from-the-order).

### Step 1 — the header

Click **Record sale** and fill in:

- **Platform** — the marketplace the sale happened on. Start typing to search your platform
  [contacts](contacts.md). A sale is single-platform. When the sale list is [filtered to a
  platform](#finding-a-sale), that platform is **pre-filled** — recording a sale while looking at
  one marketplace is nearly always a sale on it — and you can still change it.
- **Buyer** — who bought (optional). Search or add a buyer contact; leave it blank if the buyer
  is unknown or anonymous.
- **Order number** — the transaction/order number from the marketplace (optional), so you can
  reconcile the sale against the external system later. Shown on the sale row and header.
- **Transaction link** — the address of the order/transaction page on the marketplace (optional).
  Paste whatever the platform gives you; it is stored as-is.
- **Sale date** — defaults to today; the FX rate to your base currency is frozen at this date.
- **Currency** — fixed by the platform and shown locked; every amount on the sale is in it. The
  first time you sell (or list) on a platform that has no currency yet, you pick one inline and it
  is saved to the platform.
Every amount field accepts either a comma or a period as the decimal separator — type `12,50` or
`12.50`, whichever your keyboard gives you. It also takes a small sum: type `12,50+7,50` or
`(4,20+1,80)/2` and the field replaces it with the result as soon as you leave it. Once you leave
it — Tab, Enter or a click elsewhere — the amount is shown with two decimal places (`1,5` becomes
`1.50`, `3` becomes `3.00`), and a third decimal is rounded half up (`1.555` becomes `1.56`): what
the field shows is what is saved. An empty field stays empty.

- **Buyer handling** and **Commission** — the amounts you know at sale time: the postage/handling
  the buyer paid you (**adds** to proceeds) and the platform's fee (**subtracts**).
  - **Buyer handling has two entry modes.** By default you enter the **total the buyer paid** and
    the handling is worked out as **total − the offer prices**; the total is remembered, so as you
    add sold sets the handling **shrinks by itself** and the total stays put. Use **Enter handling**
    to type the handling directly instead (then the handling is fixed and the total is whatever the
    offers plus handling come to). At creation no sets are picked yet, so the total equals the
    handling until you add them. A total below the offer prices — which would make handling
    negative — is flagged and can't be saved.

- **Shipping option** and **Postage** — how the buyer asked for it to be sent, and what
  posting it costs you (**subtracts**). The envelope and cards it goes in are added on the sale
  itself — see [Packing supplies](#packing-supplies). The list is the platform's own: the
  [shipping options](platforms.md#shipping-options) you set up on the platform, each shown with what
  the buyer pays for it. Picking one fills in the postage and its currency from the carrier service
  the option is linked to — what that service costs *you*, from your rate list under
  [Settings → Carriers](collections.md#carriers); an option linked to no service leaves the postage
  for you to enter. Change either afterwards whenever this parcel cost something else. **Custom…**
  lets you name a one-off option that isn't worth adding to the list. Both stay editable on the
  detail screen — the real postage often turns up later than the order. The service's carrier is a
  default for the [shipment](#tracking-the-shipment), overridable on each sale.

- **Sent as** — the carrier service the parcel actually goes by, when it is not the one the buyer's
  option is linked to. See [Sent as](#sent-as).

**Continue** creates the sale and opens its detail screen.

### Step 2 — add the sold sets

On the detail screen, **Add sold sets** opens a browse-and-pick dialog listing every
[set](offers.md) still sellable on the sale's platform, grouped by offer. Each offer is listed by
its **title** — the one you typed, or the one the app generated — with the label derived from its
sets underneath, so you recognise a listing either by what you called it or by what is in it. An
offer with no title shows that derived label on its own. **Search** matches the **title**, the
derived label, a set, a catalog number, or the **location ref** of a copy inside a set. Each set is
a whole sellable piece:

- A single-set offer is **one row** — ticking it sells the whole thing.
- A multi-set (quantity) offer is a **collapsible row**; expand it to tick the specific sets the
  buyer took. A set is indivisible — a series never breaks apart, so selecting it retires all of
  its copies together.

Your ticks survive the search box and the **Type** facet, so you can find one listing, tick it,
search for the next and add them together. When some of what you have ticked is off screen the
button says so — **Add 7 sets (3 hidden by these filters)** — and with everything on screen it
stays a plain **Add 7 sets**.

Tick every set that sold and set each one's **sale price** in the sale currency (the offer's
asking price pre-fills, since the offer and the sale share the platform's currency). The price is
just a starting point — **override it** whenever the set actually sold for a different amount (say
you gave the buyer a discount). The override belongs to **this sale only**; the offer's own asking
price is never changed. **Add** records them all at once. You can come back and add more sets later,
or **Remove** one from its row menu.

Every ticked set needs a price, so if you clear one and then search it away — or fold up the offer
it sits in — **Add** goes dead over a row you can no longer see. The dialog says which: a warning at
the foot of it reads **2 picked sets have no price**, and pressing it clears the search and any
other filter that was hiding them and shows exactly those sets, opening the offers they sit in. The
**Without a price** entry under **Selected** does the same thing and stays lit while the list is
narrowed that way, so you can see the picker is showing a slice and click it again to come back.
Both disappear the moment the last price is filled in.

Already added a unit at the wrong price? On the **Sold units** list, click a unit's price to **edit
it in place** — the existing figure is selected as the editor opens, so typing replaces it outright
(Enter or click away saves, Escape reverts) — again, only the sale record changes, and
the gross, net, and any total-based buyer handling recompute automatically.

A sale is **single-currency**, so only offers in the sale's currency can be added. If you changed
the platform's currency after listing, any offer still on the **old** currency is shown flagged
**⚠ CUR — re-list** and can't be selected — re-list it in the platform's current currency first.

### Selling copies that are on no offer

Not every stamp that leaves was listed first — one sold to someone who asked for it, at a fair, to a
friend. **Add copies**, beside **Add sold units**, sells such copies without making an offer for
them. It opens a picker of every copy **in stock** — in hand, not sold, not traded away, not
disposed of — whatever it is kept for, with the area tree and year facets on the left and a filter
box over the list (stamp, issue, catalog number or location ref). Tick the copies, type the **price
for the set** in the sale's currency and press **Add**: the copies become **one set on the sale,
with that one price**, as an offer's set is sold at one price rather than stamp by stamp. The price
starts empty and has to be typed — there is no offer to take an asking price from.

Each pick is a set of its own, so open **Add copies** again for the next one; a sale can hold any
number of them beside sets from offers. On the **Sold units** list such a set reads *on no offer*
beside its copy count, is named by its copies, and its price can be edited in place like any other.
It appears nowhere in **Offers**, and on the [packing list](#printing-a-packing-list) its **Offer**
column reads `—`.

A copy that is also in an offer can be picked. That offer is then flagged **Needs action**, exactly
as when a copy sells under another listing — see [what a sale changes](#what-a-sale-changes).

The same can be done from **Copies**: tick the copies and choose **Sell…** — see [selling copies
without an offer](inventory.md#selling-copies-without-an-offer).

### Step 3 — amounts

The **Amounts** section shows the proceeds breakdown: the gross of the line prices, the shared
amounts, and the resulting net. Each shared amount — **my shipping** (−) and **commission** (−),
plus **buyer handling** (+) when you entered it directly — is **editable in place**: rows with a
pencil (✎) can be clicked to edit. Click the value (or **Set** when empty), type the amount, and
press Enter (Escape reverts).

When the sale's currency differs from your base currency, each amount also shows a base-currency
equivalent (**≈ 200 PLN**) beside it — gross, buyer handling/total, commission, and each sold unit's
price — converted at the sale's **frozen** rate. The net proceeds are already shown in the base
currency, and the sale list shows each sale's net in base too.

**The shipping row carries the option too.** Click it and the first control is the shipping option
the buyer chose — the platform's list, plus **Custom…** for a one-off you name here — followed by
**Sent as** ([below](#sent-as)). Picking a listed option re-fills the cost with its service's usual
price, still editable. Clearing the amount leaves the option standing: knowing a parcel went
registered is worth recording before the postage receipt turns up. Renaming or re-pricing an option
later never rewrites a sale already recorded — each sale keeps the name it was sent under — and an
option a sale points at can't be deleted; rename it instead.

### Sent as

What the buyer chose and how the parcel actually went are two different facts. A parcel that turns
out bigger or heavier than the buyer's option allows goes by another service — the carrier's next
size up, or another carrier altogether. **Sent as** records that service, from the whole of your
rate list under [Settings → Carriers](collections.md#carriers), of any carrier.

- **It starts as the option.** Its first entry, *As the option*, names the service the buyer's
  option is linked to, and a sale that never says otherwise — every sale recorded before Sent as
  existed among them — goes by that service.
- **The postage follows it.** Picking a service fills in what it costs you, still editable;
  back to *As the option*, the option's service's cost. While a sale is sent as another service,
  changing the option no longer touches the postage. Postage you type is what is saved — the last
  word, as before — and a sale with neither a linked service nor Sent as has typed postage only.
- **So do the packing supplies**, by the [same rule](#packing-supplies) as a change of option: lines
  still exactly the old service's become the new one's, lines you changed stay.
- **And the carrier**: the [Mark as sent](#fulfillment-status) prompt pre-selects Sent as's carrier.
  A carrier already recorded follows too when it was the old service's; one you picked by hand stays.
- **The buyer's option stays as recorded**, with what the buyer paid for it — the buyer message, the
  packing list and the option's own name still say what was bought.

The **Postage** row names Sent as — *sent as InPost: Locker* — only when it differs from the
option's service, so the common case stays quiet. Change it on that row or in **Edit header**.

**My shipping can be in any currency.** Postage is often paid in your own currency, not the
marketplace's, so the shipping row has its own currency selector (defaulting to the sale currency).
Whatever currency you pick, the cost is converted **straight to your base currency** at the rate on
the sale date, and it's the base amount that feeds profit. The row shows the base equivalent beside
a foreign-currency amount (or flags **no rate** if none is known yet). Because shipping lands in the
base currency, the **net proceeds** figure — on the sale, its rows, and the list — is shown in the
**base currency**. For a single-currency collection (base = sale currency) nothing looks different.

### Packing supplies

What a parcel costs you is more than its postage: the envelope and the transport cards go in too.
The **Packing supplies** card under the amounts records them — **Add supplies**, pick a supply and
say how many the parcel used (*C6 envelope × 1*, *Transport card A6 × 2*). There is no price to
type: the supplies are **taken from your stock**, oldest batch first, and each unit costs what it
cost in the batch it came from ([Packing supplies](purchases.md#packing-supplies)). Name your
supplies once under **Settings → Packing supplies** first.

**My shipping is then the postage plus the supplies**, added up for you. The amounts show it as two
rows — **− Postage** and **− Packing supplies**, the latter in your base currency — and the card's
header states the sum with its parts: *Postage 12.00 + supplies 1.40 = my shipping 13.40 PLN*. The
net and the profit use that total.

- **Changing or removing a line returns the supplies to stock**, to the batches they came from, at
  the costs they were taken at. Using fewer gives back the units taken last. Deleting the sale
  returns all of them.
- **You can use more than you have on hand.** The line is kept, the units your stock did not have
  are named on it (*2 units not in stock*) and cost nothing yet, and the supplies figure and the
  profit are marked **incomplete** — the profit with `≤`, since the true figure can only be lower.
  The next purchase of that supply covers them by itself, earliest sale first, and the mark goes.
  The **Packing supplies** screen says how many units sales are waiting for.
- A unit from a batch bought in another currency with **no rate** into your base currency is
  counted the same way — no cost yet, the total incomplete — until the purchase has a rate.
- **A shipping option can fill them in.** When the [carrier service](collections.md#carriers) a
  platform's [shipping option](platforms.md#shipping-options) is linked to lists its usual supplies,
  choosing the option — when you record the sale, on the **Postage** row or in **Edit header** —
  adds those lines, taken from stock like any other; adjust them for this parcel as you need.
  **Changing the option** — or [Sent as](#sent-as) — swaps the lines that are still exactly the old
  service's for the new one's, and keeps any line you changed or added yourself (a line you raised to *5 cards* stays, and
  the new service's cards are not added beside it). Saving the same option again brings back nothing
  you removed.
- **A sale recorded before supplies existed keeps its typed amount** as its whole shipping, and its
  row still reads **− My shipping**. Add supply lines to it only if you want to restate it as
  postage plus supplies — then lower the typed amount to the postage alone.

If the sale is anchored on the **total paid** (the default), the breakdown instead shows an
editable **Total paid by buyer** row and a read-only **buyer handling** derived below it — the
handling follows the total minus the offer prices and re-settles automatically as you add or
remove sold sets. If the total ever falls below the offer prices, handling is held at 0 and a
warning asks you to raise the total. Switch a sale between the two modes any time from **Edit
header**.

Once a transaction link is set, a **Transaction** link appears on the sale row and in the detail
header, and opens the marketplace's order page in a new tab. On the row it opens the link only — the
sale itself doesn't open — and it's also in the row's **⋮** menu as **Open transaction**. In the
header, use the **✎** beside the link to change it without navigating away; if no link is recorded
yet, click **Add transaction link** and type one. You can set or change it whatever the sale's
[status](#fulfillment-status) is, including long after it was delivered — the order page is usually
what you go back to once a sale is done.

You can revise the header (platform, buyer, date, buyer handling, commission) any time with
**Edit header** — though the platform is locked once units are recorded, since a sale stays on one
platform. The currency stays fixed as a permanent record: editing a sale never rewrites it, and
changing the platform's currency later leaves existing sales untouched.

## What a sale changes

- The exact **copies** that left are recorded on the sale and become **unavailable** — they drop
  out of your for-sale inventory and can never be sold twice.
- Each **offer** flips to **Sold** once *every* one of its sets has sold through it; a partial sale
  keeps it **Active** for its remaining sets — and marks it **Changed since listed**, because the
  live listing now advertises a quantity it no longer has and pictures a copy that has gone. Push the
  update (regenerating the photos on the way, which drops the sold set from them), or say the listing
  is up to date by hand. See [listings that no longer
  match](offers.md#listings-that-no-longer-match).
- Any **other active offer** — on another platform — holding a set with a copy you just sold is
  flagged **Needs action**, so you can take those stale listings down. See
  [keeping platforms in sync](offers.md) on the Offers page. A copy sold [on no
  offer](#selling-copies-that-are-on-no-offer) flags every offer holding it the same way.
- **Removing** a unit from the sale puts its copies back in stock, whether it came from an offer or
  from no offer at all.

The shared amounts are split across the sold units in proportion to their sale prices, and each
unit's net is converted to your base currency at the frozen rate — this is what
[profit and loss](#profit-and-loss) is measured from.

## Profit and loss

Under **Net proceeds**, the **Amounts** section shows what the sold copies **cost** you — their
[cost-basis](inventory.md#cost-basis), in your base currency — and the **profit or loss**: the net
proceeds minus that cost, green for a profit and red for a loss. Each sold unit's card shows its
own **profit** under its net, too: the unit's net against the cost of the copies in it.

A profit is only stated where it can actually be worked out. A copy is **left out** — never
counted as costing nothing — when:

- **its cost is pending and cannot be estimated** — it belongs to a purchase lot that is still open,
  and no estimated cost can be worked out for it (see below);
- **it has no cost recorded** — you added it by hand, or it came through no purchase lot (on the
  sale's own screen such a copy is counted instead, see [Incomplete profit](#incomplete-profit-a-copy-with-no-cost));
- **it has no opening value** — it came in on an [opening balance](purchases.md#opening-balances)
  whose lot was given no value, so there is nothing to measure a profit against (a copy from a lot
  *with* an opening value counts against its share of it, as against a purchase price);
- **there is no exchange rate** — the sale, or the shipping you paid, is in another currency and no
  rate to your base currency is known for the sale date; then none of the sale's copies can be
  counted;
- **its share cannot be split** — its own cost is known, but it went in the same unit as a copy
  that is left out, and the unit's net cannot be divided between them because a copy on it has no
  catalog price.

On a sale where only some copies are left out, the figure is marked **incomplete**: the cost and
profit cover the copies that could be counted, and a note says how many of how many that is,
what their proceeds were, and why the rest were left out. Where nothing can be counted, the row
reads **cannot be computed** and the note says why. A sold unit shows its profit only when every
copy on it counts; otherwise it reads **profit —**, and hovering it says which copies are missing
what.

**Estimated profit while a purchase lot is still open.** A copy whose lot is not closed yet has no
settled cost, but it has an **estimated** cost — the figure its purchase order and its own page show
— and this screen counts it at that estimate, so you can judge a sale before you close the lot. A
profit that leans on one is marked as an estimate the way an estimated cost is: `~`, muted and
italic, on the unit's profit and on the sale's cost and profit, which is then labelled
**estimated**; a note (and the unit's hover) says how many copies are estimated. Once the lot is
closed, the same figures show the actual cost, with no mark and nothing for you to do. A copy whose
cost cannot be estimated (no catalog value, no exchange rate on the purchase, not delivered) is
still left out as pending. Only the sale's own screen counts estimates: the profit and loss screen
and the Overview keep such a copy pending until its lot is closed.

#### Incomplete profit: a copy with no cost

A copy with **no cost recorded** at all — not pending, simply none — would otherwise hide the profit
of the whole unit it sold in: one such copy in a set of twenty would leave the set reading
**profit —**. So the sale's own screen counts the unit over the costs it **does** know, and marks the
figure as **incomplete**, e.g. *profit ≤ +18.40 EUR · 1 copy without cost*.

- **`≤`** says the figure is a ceiling, not an estimate: it leaves out a cost, so the true profit
  can only be lower. Hovering *1 copy without cost* says so.
- Clicking **1 copy without cost** opens a short list of those copies; each one links to the copy's
  own page, where you set its cost.
- The sale's **Profit / loss** is marked **incomplete** too, with `≤` on its figure and a note
  naming the copies the same way.
- Once every such copy has a cost, the mark goes and the unit shows a plain profit.

A copy from an opening balance with no value is still left out (see above): its cost is not missing,
it was deliberately not stated. And as with estimates, only the sale's own screen counts these
copies: the profit and loss screen and the Overview still leave them out.

**Packing supplies without a cost** — units used beyond your stock, or from a batch with no exchange
rate ([Packing supplies](#packing-supplies)) — mark the sale's **Profit / loss** as **incomplete** in
the same way, with `≤` and a note saying how many units. They cost nothing in *my shipping* until a
purchase covers them, and so on the profit and loss screen and the Overview as well.

### The profit and loss screen

Click the **Realized profit and loss** tile on the [Overview](overview.md) to open the **Profit and
loss** screen. It shows where that figure comes from. Everything on it is in your base currency.

- **Dates** — pick a **From** and a **To** date to look at part of the collection's history; either
  end can be left open. **All dates** clears both. A sale counts on the day it was sold, and a
  write-off on the day it was recorded.
- **Totals** — three figures: the **sales** profit or loss (with the proceeds, the cost and the
  number of sales), the **write-offs**, and the **result**: the sales profit less the write-offs.
- **By period** — the same figures for each **Month** or each **Year** that had a sale or a
  write-off, oldest first, with a total at the bottom.
- **By platform** — the sales figures for each platform. Write-offs have no platform, so they are
  their own line, and the result under them is the same result as in the totals.
- **By sale** — every sale in the range, newest first: its date, number, platform and buyer, and its
  net proceeds, cost and profit. These are the figures the sale's own screen shows, except that a
  copy whose purchase lot is still open stays pending here rather than counted at its estimated cost,
  and a copy with no cost recorded is left out here rather than counted at none.
  Click a row to open the sale.

**Write-offs** are the copies you marked as no longer held — lost, damaged or otherwise gone. They
brought in nothing, so what they cost is a loss, and leaving them out would make the result look
better than it is. A copy that was sold and then marked gone counts only with its sale.

The rules for copies that cannot be counted are the ones [above](#profit-and-loss): a copy is left
out — never counted as costing nothing — and every line that left one out says how many and why. A
written-off copy whose cost is still pending, or has none recorded, adds nothing to the loss and is
counted apart the same way. A line where nothing at all could be counted shows **—** instead of a
figure.

With **All dates**, the sales figures are exactly the ones on the Overview tile.

Added up over every sale, these are the figures the [Overview](overview.md)'s **Realized profit and
loss** tile shows. A copy [traded away](trades.md) is not a sale and has no profit here.

## Fulfillment status

A sale carries a **fulfillment status** that tracks its progress through a fixed sequence:

**Ordered → Paid → Packed → Sent → Delivered**

A new sale starts at **Ordered**. On the detail screen's header, the **Status** control lets you
either pick any step from the dropdown or click the **→ next** button to advance one step. Each
change is saved immediately and stamped with the moment it happened, so the sale keeps a timeline
of its transitions. The current status also shows as a chip on each sale's list row.

Status is independent of everything else on the sale — advancing it never changes copies or offers,
and it can move backward (pick an earlier step) if you need to correct a mistake.

**Moving to Paid asks for the money.** The moment you mark a sale **Paid** is the moment you read
the amount off the marketplace, so if the sale doesn't have a buyer-side figure yet, a small
**Mark as paid** prompt asks for the **total paid by buyer** — the same anchor the amounts card
uses, with buyer handling derived from it (total − offer prices) and shown as you type. Save it and
the sale moves to Paid in one step; **Skip** moves it without recording anything, and you can fill
the total in later on the amounts card. A total below the offer prices is refused there and then,
since handling can't be negative.

The prompt only appears when the buyer side has **no** figure at all. A sale that already carries a
total paid — or a buyer handling you entered directly — is not asked again: the two are alternate
anchors for the same money, and answering would replace the one you chose.

**Moving to Packed — or past it — asks about unpacked copies.** If some of the sale's copies are
still not [marked packed](#packing-view), moving the sale to **Packed**, **Sent** or **Delivered**
stops and asks, naming how many are unmarked. You get three answers:

- **Mark all packed and move** — they did go in the parcel and the marks were simply never made.
  Every copy on the sale is marked packed, and the sale moves on.
- **Move anyway** — the sale moves and the copies stay as they are.
- **Do nothing** — nothing changes: not the status, not a single copy.

It asks on a jump too, not only on the step into Packed: going straight from Paid to Sent with
copies unmarked is the same question, and a sharper one, since the parcel has supposedly gone. It
never asks when every copy is already packed, and it never asks on a move *backwards* — putting a
sale back to Packed from Sent is a correction, not a packing decision.

**Moving to Sent asks about the parcel.** The moment it goes is the moment you know which courier
took it and hold the receipt with the number on it, so a **Mark as sent** prompt asks for both. The
carrier arrives **pre-selected** from the service the sale is [sent as](#sent-as) — change it when
the parcel went another way — and the prompt says what the choice means: whether that carrier will turn the number
into a link, or whether it has no tracking page recorded. **Skip** moves the sale to Sent without a
number, which is the right answer for postage that carries no tracking at all. As with the paid
prompt, a sale that already has a tracking number isn't asked again.

## Tracking the shipment

A sale records **who carried the parcel** and its **tracking number** — the number free text,
exactly as the carrier gave it to you. Both live in one **Shipment** dialog: it opens at the
[**Sent** transition](#fulfillment-status), and again from the detail header — **Add tracking
number** when there is none, or the **✎** beside the 📦 chip to correct what was recorded. Like the
transaction link, either can be set or changed whatever the sale's status is.

**The carrier of a shipping option is only a default.** It is the carrier of the service the sale
is [sent as](#sent-as) — the one the option is linked to, unless you named another. On a marketplace
you offer a *service* — "Courier" — and which courier actually takes the parcel is settled at the
counter, so that carrier is a suggestion the Shipment dialog pre-selects and you override per sale.
A sale that never says anything of its own keeps following that service's carrier.

Whether the number becomes a **link** depends on that carrier:

1. Add the carrier under **Settings → Carriers** with its **tracking address** — the page where it
   looks a parcel up, with `{code}` where the tracking number goes, e.g.
   `https://emonitoring.poczta-polska.pl/?numer={code}`. Leave the address blank for a carrier with
   no tracking page.
2. Link the platform's [shipping option](platforms.md#shipping-options) to one of the carrier's
   services, so the common case needs no thought.
3. Record the sale, pick the carrier that actually took it when you mark it Sent, and the tracking
   number becomes a **📦 link** straight to the parcel.

Without a carrier — or with one that has no tracking address — the number is still recorded and
shown, just as plain text; hover it and the chip says which of the two is missing. Because the link
is built when the sale is read rather than stored on it, a carrier that moves its tracking site is
corrected in one place and every sale it ever carried follows.

## Packing view

The detail screen doubles as a **packing list**. Each sold set is a collapsible card whose header
shows the set, its copy count, price, net and [profit](#profit-and-loss). Expanding it shows the
exact physical copies that left — as full inventory rows with catalog number, condition, and
**location**, so you can pull each piece to pack it. It works like a purchase order:

- The primary grouping is **Set** (each sold set its own card, the default), **Location** (a
  section per storage spot — a packing walk-order, so you clear one spot at a time), or neither
  (a flat stream). Lot and Location are mutually exclusive.
- **Issue** sub-groups the copies within whichever primary you chose.
- **Sort copies** orders the copies; the card and issue headers **stick** to the top as you
  scroll a long order. Sorting by **Location ref** reads the usual `prefix + number` scheme —
  prefix first, then the number — so `A9`, `A10`, `A100`, `B-3000` come out in shelf order.
- Copies load lazily, so even a large sale opens quickly. Use **Collapse all** / **Expand all**
  to switch between an overview and full contents.

**The sets open collapsed, and the screen remembers which ones you opened.** A sale you have never
opened shows every set folded up, the way the lot and set cards on the [purchase](purchases.md),
[offer](offers.md) and [auction sale](auctions.md) screens open — a sale of many sets is then a short
list to scan rather than a long scroll. Whatever you expand or fold, card by card or with **Collapse
all** / **Expand all**, is kept **for that sale**: reload the page, or come back to it from another
screen, and the same sets are open. A set you add while the screen is open opens itself, since it is
the one you are looking at, and is remembered like any other. The memory lives in this browser, for
the fifty sales you opened most recently.

Each copy row has a **packed** checkbox on its left. Tick it as you physically pack that piece —
packing happens copy by copy, so this is tracked **per copy**, independent of the sale's overall
[status](#fulfillment-status). When every copy on the sale is packed, the header shows a gentle
**"All copies packed — advance to Packed?"** hint next to the status control; it's only a reminder —
you still advance the status yourself, it never changes on its own.

Remove a sold set from its card's **⋮** menu (its copies become available again).

### Choosing which set left

An offer listed at quantity 3 holds three sets, and a buyer who takes one has said *one of these*,
not *this one*. They are the same thing at the same price — that is why they are one listing — so
**which copy actually goes is your choice**, made at the packing table. Pick a piece up, find a thin
on it, and send the next one instead.

Any sold unit from an offer has **Choose set** in its **⋮** menu (a set of [copies on no
offer](#selling-copies-that-are-on-no-offer) has no other set to be, so its menu offers only
**Remove**). It names the offer by its **title** where it has
one, and by the label derived from its contents where it does not — the same name it goes by on the
offers list. It lists the sets of that unit's own offer that are still available and marks the one
the line names today with **On this line now** — including when there is only one, since what you
came to see is which set this line is standing on.

Each set is shown **with its copies opened out**, as full inventory rows with their scans, catalog
number, condition and location. That is the point of the dialog: choosing between interchangeable
sets is choosing between physical pieces, and what separates two copies of the same stamp — a thin,
a short perf, the cancel — is something you can only see. Compare the pictures, pick the one that is
actually going in the envelope, and press **Choose**:

- the **sale price stays** — it is what the buyer paid, and swapping which copy goes does not change
  it;
- **packed** ticks go with the copies they were about, so the new copies start unpacked;
- a set whose copies have already left on another sale isn't offered, and can't be chosen;
- choosing the set that is already on the line simply **confirms** it — nothing moves, and the
  packing you have already done survives.

Sometimes a unit arrives with **⚠ Set not chosen** on it — an import or a buyer's own pick named one
of the interchangeable sets without anybody deciding. Recording a [Colnect
transaction](assistant.md#your-colnect-sales) through the Assistant is the usual way it happens: the
transaction says a copy of that listing sold, not which of yours goes in the envelope. The chip is the button as well as the flag:
press it and the picker opens, so you never have to go looking for the menu.

On a sale holding such units the toolbar above them grows a **Set** filter — **All** / **Not chosen
(N)** — so you can narrow the sold units to exactly the ones still waiting on you and work through
them without scrolling past the settled ones. It appears only while something is actually waiting,
and stands down by itself once you have settled the last one. Like **Packed** beside it, it narrows
what is listed and changes nothing.

The same chip appears on that sale's row in the sales list, where a **Set not chosen** filter narrows
to the sales still waiting — that one answers *which parcels* need attention, before you open any of
them.

### Letting the buyer choose

You are not always the best person to choose. Your buyer bought a stamp from a picture, and your
three copies are the same thing only as far as the listing was concerned — the centring, a corner
perf and the exact shade differ, and the person who is going to own it has an opinion. So you can
hand the decision over.

While a sale has a unit waiting on a set choice, the detail header carries **Ask the buyer**. It
generates a link — no account, no sign-in — that you send with your usual message. The page behind
it shows the units nobody has chosen a set for, each with **photos of your actual copies**, and a
radio under each. Nothing else is on it: not the prices, not the rest of your collection, not the
copies' numbers or where they are filed.

- The buyer's pick **moves the copies straight away**, exactly as your own **Choose set** does: the
  price stands, the flag clears, and the unit card gains a green **Buyer chose** chip so you know at
  the packing table that the copy in front of you was asked for.
- They can **change their mind** as often as they like — until you mark the sale **packed**. From
  then on the page says the copies are settled and takes no more answers, which is why marking a
  sale packed is worth doing when you actually pack it.
- **You always have the last word.** Opening **Choose set** and picking something else replaces
  their answer with yours, and the *Buyer chose* chip goes with it.
- The dialog shows the link's address whenever it can, says when the buyer last opened it, and
  carries **New link** (the old address stops working) and **Withdraw**. An optional expiry date is
  there if you want one; left blank, the link lives until you withdraw it.

## Message to the buyer

After a sale you write the buyer how much to pay, where to pay it and what happens next. The sale
already knows the figures, so the platform can write that message for you from a template:
**Message to buyer** in the detail header shows it, rendered for this sale, and **Copy message**
copies it — plain text, ready to paste into the chat — with a confirmation at the edge of the
screen.

The template is set per platform: on the [platform](platforms.md#message-to-buyer), or for
Facebook under **Settings → Facebook**, where a group can have its own
([Facebook](facebook.md#buyer-messages)). A platform without a template offers no message — the
button is simply not there. The account number and the next steps are ordinary text in the
template; the rest are placeholders:

| Placeholder | Becomes |
| --- | --- |
| `{buyer}` | the buyer's name |
| `{items}` | the items sold, one per line: the offer's number and title (`#412 Austria 1850 Mercury`) |
| `{itemsTotal}` | what the items come to |
| `{shipping}` | the shipping option on the sale and what the buyer pays for it — empty until an option is chosen |
| `{total}` | what the buyer owes |
| `{shippingOptions}` | the platform's shipping options, one per line, each with what the buyer pays for it |
| `{sale}` | the sale's number |

**The total includes the shipping once a shipping option is on the sale**: the items plus the
postage the buyer pays — the sale's **buyer handling**, or what is left of the **total paid by
buyer** after the items. Before an option is chosen the total is the items alone, and
`{shippingOptions}` lists what the buyer can choose from, at each option's **buyer price** — never
what the service costs you. A placeholder the sale has nothing for — no buyer recorded, say — comes
out empty; nothing is filled in in its place.

**Amounts read the way a person writes them**: with the currency's symbol, where that currency puts
it — `15 zł`, `$10` — and with decimals only when they are not whole, `15.50 zł`. `{itemsTotal}`,
`{shipping}`, `{total}` and `{shippingOptions}` each say how the currency is written after a colon:
`{total}` or `{total:symbol}` gives `15 zł`, `{total:code}` gives `15 PLN`, `{total:none}` gives
`15`. On `{shipping}` and `{shippingOptions}` the choice applies to every price they list. A template
written before this, with a bare `{total}`, now writes the symbol. Anything else after the colon is
not a placeholder: it stays as typed, and the field says so under it.

**The sale number is written plain** — `57` — and can be padded with zeros after a colon:
`{sale:4}` gives `0057`. Any whole number of digits from 1 to 10 works, and a number wider than that
is written in full. Anything else after the colon — `{sale:0}`, `{sale:x}` — stays as typed and is
named under the field.

The message is written from the sale as it stands, so choose the shipping option or add a sold set
and the message follows.

## Printing a packing list

If you'd rather pack from paper than from the screen, the header's **🖨 Packing list** button opens
a print-friendly sheet for the sale. It is a plain document — no sidebar, no controls, no filters —
laid out as a walk through your shelves:

- A **header** carrying the **sale's own number** (`Packing list #12`) — this collection's name for
  the transaction, and the reference to quote when the sheet is talked about on paper — plus the
  platform, buyer, order number, sale date, [status](#fulfillment-status), and the copy/packed
  counts. The **order number** beside it is a different thing: that one is the *marketplace's*
  number for the same sale. When the sale records a **shipping option**, it prints there too, so
  the sheet says how the parcel goes out; sales without one simply don't show the field.
- One **section per storage [location](locations.md)**, in shelf order, with the copies filed
  nowhere in a trailing **No location** section.
- Inside a section, one line per copy: a **tick box** plus whichever of the columns below you
  turned on. Lines are ordered by the in-location **ref** — what you read off the shelf.
  Refs of the usual `prefix + number` shape (`A100`, `A1200`, `B-3000`) sort **by prefix first,
  then by the number**, so `A100` comes before `A1200` and the whole `A` run comes before `B`;
  the separator doesn't matter (`A-100` and `A100` sort together). Copies with no ref go last.
- Copies that are indistinguishable while packing — same stamp, same condition, same certificate
  status, same ref, same packed state — collapse into a **single line with a quantity**, so five of
  the same stamp are one line to tick rather than five.

### Choosing the columns

Above the list, a row of **Columns** chips picks what the sheet prints. They print in this order:
**Photo** (a thumbnail of the copy), **Qty**, **Ref**, **Copy no.**, **Catalog**, **Area** (the full
path, e.g. `Polska › II RP`), **Series** (the issue the stamp belongs to), **Stamp**, **Condition**,
**Certificate**, and **Offer no.** Click a chip to turn its column on or off — the tick box always
stays, since it's the point of the sheet. The chips themselves never print, and each column is only
as wide as its own content needs, so turning columns off tightens the sheet instead of leaving gaps.

**Copy no.** is each copy's [internal number](inventory.md) — the one written on the piece or its
label — printed exactly as wide as your collection writes it. A line that stands for several merged
copies lists **every** one of their numbers, since each is a separate piece to find. **Offer no.**
is the [offer](offers.md) the line was sold through; it reads `—` on a line whose listing has since
been deleted, and can name two offers where merged copies came from different ones.

Your selection is remembered **globally**, across every sale and every collection: it describes how
you like to pack, not something about one order. So set it once and every packing list you open
comes out the same way. (Adding the two number columns reset the remembered selection once, so that
they actually show up — if you had customised the chips before, set them again.)

Copies you already ticked as **packed** in the app print with a **✓** in the box; the rest print
empty, for ticking by hand. The sheet is a snapshot — ticking on paper doesn't change anything in
Stamporama, so update the packed checkboxes on the detail screen when you're back at the computer.

Each printed page carries two lines at its foot. The first identifies the sale on its own — the
**sale number**, **platform**, **buyer**, **order number**, **sale date**, the **copy count** and
the **status**. The second says where the printout came from: **Stamporama** and its version, the
collection, and the date and time the sheet was **generated** — in your own timezone, not the
server's, so it reads as the clock you printed it by. Each keeps to its own line and is shortened
with an … when it runs past the paper, so the foot of the page is always the same depth. The list stops
above it on **every** page — no row is hidden under it, a row is never split between two pages,
and the column headings repeat at the top of each page the list continues on.
So a page that slips out of the stack can still be matched back to its order, two printouts of the
same sale can be told apart, and a sheet found weeks later says where it came from. The note about
the tick boxes closes the document, after the last row.

**Page numbers** come from the browser, not from the sheet: tick **Headers and footers** in the
print dialog and every page is numbered (the dialog also adds the date and the page title there).
Browsers don't render page numbers that a web page asks for itself, so this is the one setting the
packing list can't set for you — the screen reminds you of it above the list.

Click **🖨 Print** for your browser's print dialog (or print/save as PDF from the browser menu).
The sheet always prints in light colours, even if you use the dark [theme](appearance.md).

## The conversation with the buyer

What you agreed with a buyer — which copies, the price, shipping, payment, their address, a
complaint — usually lives in Messenger, e-mail or the marketplace's messages. The conversation log
keeps it with the sale, so you do not have to search those histories again.

**Conversation (N)** in the sale's header opens it — *N* is how many entries this sale has, and with
none the button reads just *Conversation*. It is there whenever the sale has a buyer. The log opens
in a **panel at the right side of the window**, over the page, so you can read the sale and what was
said about it side by side; the page under it does not move, and a long conversation scrolls inside
the panel. Close it with its **✕** or **Esc**. If you leave it open, it stays open as you move to the
next sale.

Each **entry** says **when** it was said, the **channel** (*Messenger*, *E-mail*, *Allegro messages*,
*Phone* or *Other*), the **direction** (*From the buyer*, *To the buyer*, or a *Note*), a short
**summary**, and optionally a **quote** of what matters word for word (an agreement, an address, an
amount) and a **link** to where the conversation can be found. Entries are listed newest first.

- **An entry belongs to the buyer, and only optionally to a sale.** A conversation often covers
  several sales, or happens before there is one. The panel shows **This sale**'s entries; **All with
  this buyer** shows the whole history with them, each entry naming its sale. The same log is on the
  buyer's [contact page](contacts.md#the-conversation-log).
- **Add entry** writes one by hand; an entry's **⋮** menu **edits** or **deletes** it. In the dialog,
  **Sale** chooses which of the buyer's sales it is about, or *No sale*.
- **Entries an [AI assistant](agent-api.md) wrote are marked *Assistant*.** That is mostly how the
  log is filled: the assistant reads the conversation and records it. Nothing waits for your
  review — an entry is a record, not an act.
- **An entry can keep files** — a payment confirmation, a photo of a damaged stamp, a scan of a
  certificate, a screenshot of what was agreed. **Attach files** in the entry's **⋮** menu adds
  pictures (JPEG, PNG or WebP) and PDFs, several at a time and up to 20 on one entry, each as large
  as a photo may be (200 MB). They are shown under the entry: a picture as a thumbnail that
  enlarges when clicked, a PDF by its name, which opens it in a new tab. The **×** on a file removes
  it. Files are kept as they came, belong to their entry alone — they never become offer photos —
  and are deleted with it. An assistant can attach them too.
- **An entry changes nothing else** — no sale, status or amount.
- **An entry stays with the person it was with.** If you change a sale's buyer, its entries stay
  with the previous buyer and no longer name the sale; the same happens when the sale is deleted,
  or merged into a sale of a different buyer.

## What the assistant recorded — *To review · API*

When an [AI assistant](agent-api.md) records a sale for you (see [what it can do on sales](agent-api.md#what-it-can-do-and-what-it-will-not)), or adds a sold offer to one you already
have, the sale is marked **To review · API** — on its row in the Sales list and on its own screen —
and it stays marked until you say you have looked. An assistant reading a marketplace thread can
match the wrong buyer or a wrong price, and this is how you find what it wrote. Hover the chip to see
what it did — *added offer #2680 at 15 PLN*, one entry per thing — and when it last wrote. Several
writes before you confirm add up, so a sale it recorded and then added a second offer to names both.

- **The assistant cannot remove the mark.** Nothing it can ask for clears it.
- **Editing the sale does not remove it either.** Correcting a price or moving the sale to *Paid* is
  not the same as having checked the whole sale, so the mark stays until you press **Confirm**.
- **Confirm** beside the chip on the sale's screen, or **Confirm review** in the row's **⋮** menu,
  clears it. Both appear only while the sale is marked.
- **To review** in the toolbar narrows the list to the marked sales, and the
  [Action items](action-items.md) bell lists them under *Sales recorded by an agent, to review*.
- **Nothing else changes.** A marked sale counts in your figures, retires its copies and moves
  through its statuses exactly like any other.

## Merging two sales

Sometimes two sales have to become one — two were recorded by mistake for the same buyer, or one
buyer bid from two accounts and asked for everything to go together, in one parcel and one payment.
**Merge with…** in the header of a sale's screen does it.

1. **Choose the other sale.** Only sales on the **same platform**, in the **same currency** and
   **not yet sent** are offered; a sale already *Sent* or *Delivered* has no **Merge with…** at all.
2. **Choose which one remains.** It keeps its own buyer, date, order number, transaction link,
   shipping option and status. The other is deleted once everything has moved; its number is never
   given to another sale, and its buyer's contact stays as it is. The dialog names the other sale's
   order number and buyer before you merge. On Allegro, an order whose sale is merged away loses
   its order number, so the Allegro worklist offers that order again.
3. **Choose each amount** — buyer handling (or the total paid), commission and postage — from either
   sale, or their **Sum**. The last column shows the merged sale as it will be: its gross, each
   amount, and what the buyer pays, with a warning when a total paid would be below the gross.
   Picking one sale's *total paid* suits a buyer who paid once for everything; the sum of two totals
   is what both payments came to. Postages paid in two different currencies can't be summed — take
   one of them.

**Merge** then moves every sold set — with its price, its packed marks and any set still to be
chosen — and every packing supply the other sale used, and the [conversation
entries](#the-conversation-with-the-buyer) about it when the remaining sale is with the same buyer.
Nothing is sold or withdrawn twice: the copies stay sold and the offers stay *Sold*. The totals, profit and [message to the
buyer](#message-to-the-buyer) follow at once. If the other sale was recorded by an assistant and you
had not [confirmed](#what-the-assistant-recorded--to-review--api) it, the merged sale is marked *To
review* too.

## Deleting

From a list row's **⋮** menu you can **delete** a sale — that removes the record, makes its copies
available again, returns any offers it marked sold to **Active**, and returns its packing supplies
to stock.

## Finding a sale

Each sale carries its own **number** (`#7`), shown on the row beside the fulfillment status. It is
the collection's own number for the sale, separate from the marketplace's order number that appears
after the platform name — type `s 7` in the sidebar's **Jump to…** box to go straight to it
([Quick jump](quick-jump.md)).

The Sales toolbar has a **search** box, a **platform** filter and a row of **status** chips.
Search matches the buyer name, the platform name, the order number, and the **name or catalog
number of any copy** sold on the sale — so you can find a sale by what was in it, not just who
bought it. The platform dropdown narrows the list to a single marketplace, and the status chips to
particular [fulfillment steps](#fulfillment-status). All three combine. After the status chips,
**Set not chosen** narrows to the sales still waiting on [which set left](#choosing-which-set-left),
and **To review** to the sales an assistant recorded and you have not
[confirmed](#what-the-assistant-recorded--to-review--api); each combines with whichever status is
chosen, and neither is remembered.

A [contact's page](contacts.md#a-contacts-page) opens this list narrowed to **one buyer**. The buyer
shows as a lit **Buyer:** chip at the front of the toolbar; click it to go back to every buyer. The
buyer filter is never remembered — it comes only from the link.

The status chips select **one status at a time**: clicking a chip replaces whatever was chosen, and
clicking the one lit chip again clears it back to every status. A sale is in exactly one status, and the
list is worked through a status at a time — everything paid, then everything packed.

The chips used to be multi-select, so a link or a remembered filter you kept from then may still
name two statuses. Such a value **still means what it said**: the list shows both, with both chips
lit, and collapses to whichever one you click next.

The chip you picked is **remembered** for this collection and re-applied the next time you open
the screen; a status named in the URL wins over it, so a link you share always shows what you
meant it to.

**What you searched for is remembered the same way.** Sales is a list you work through rather than
one you look things up in — *what have I still to pack and send* is a question you come back to —
so the phrase you left in the box is there again when you next open the screen, in the box, with
its **✕** beside it, ready to be cleared in one click. As with the chips, a search named in the URL
wins over the remembered one, and clearing the box clears the memory of it.

## Related

- [Offers](offers.md) — the listings (and their sets) a sale is recorded against.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used for profit/loss.
