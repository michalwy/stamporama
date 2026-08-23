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
it: **Offers → Sold on Allegro** lists the orders waiting to be recorded, and **Record sale from
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
`(4,20+1,80)/2` and the field replaces it with the result as soon as you leave it.

- **Buyer handling** and **Commission** — the amounts you know at sale time: the postage/handling
  the buyer paid you (**adds** to proceeds) and the platform's fee (**subtracts**).
  - **Buyer handling has two entry modes.** By default you enter the **total the buyer paid** and
    the handling is worked out as **total − the offer prices**; the total is remembered, so as you
    add sold sets the handling **shrinks by itself** and the total stays put. Use **Enter handling**
    to type the handling directly instead (then the handling is fixed and the total is whatever the
    offers plus handling come to). At creation no sets are picked yet, so the total equals the
    handling until you add them. A total below the offer prices — which would make handling
    negative — is flagged and can't be saved.

- **Shipping method** and **My shipping** — how the buyer asked for it to be sent, and what
  posting it costs you (**subtracts**). The method list is the platform's own: the options you set
  up on the [contact](contacts.md#shipping-methods), each with its usual price. Picking one fills
  in the cost and its currency for you; change either afterwards whenever this parcel cost
  something else. **Custom…** lets you name a one-off method that isn't worth adding to the list.
  Both stay editable on the detail screen — the real postage often turns up later than the order.
  A method can also name the **carrier** it usually posts by — a default for the
  [shipment](#tracking-the-shipment), overridable on each sale.

**Continue** creates the sale and opens its detail screen.

### Step 2 — add the sold sets

On the detail screen, **Add sold sets** opens a browse-and-pick dialog listing every
[set](offers.md) still sellable on the sale's platform, grouped by offer. **Search** by offer,
set, catalog number, or the **location ref** of a copy inside a set. Each set is a whole sellable
piece:

- A single-set offer is **one row** — ticking it sells the whole thing.
- A multi-set (quantity) offer is a **collapsible row**; expand it to tick the specific sets the
  buyer took. A set is indivisible — a series never breaks apart, so selecting it retires all of
  its copies together.

Tick every set that sold and set each one's **sale price** in the sale currency (the offer's
asking price pre-fills, since the offer and the sale share the platform's currency). The price is
just a starting point — **override it** whenever the set actually sold for a different amount (say
you gave the buyer a discount). The override belongs to **this sale only**; the offer's own asking
price is never changed. **Add** records them all at once. You can come back and add more sets later,
or **Remove** one from its row menu.

Already added a unit at the wrong price? On the **Sold units** list, click a unit's price to **edit
it in place** — the existing figure is selected as the editor opens, so typing replaces it outright
(Enter or click away saves, Escape reverts) — again, only the sale record changes, and
the gross, net, and any total-based buyer handling recompute automatically.

A sale is **single-currency**, so only offers in the sale's currency can be added. If you changed
the platform's currency after listing, any offer still on the **old** currency is shown flagged
**⚠ CUR — re-list** and can't be selected — re-list it in the platform's current currency first.

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

**The shipping row carries the method too.** Click it and the first control is the method the
parcel went by — the platform's list, plus **Custom…** for a one-off you name here. Picking a
listed method re-fills the cost with its usual price, still editable. Clearing the amount leaves
the method standing: knowing a parcel went registered is worth recording before the postage
receipt turns up. Renaming or re-pricing a method later never rewrites a sale already recorded —
each sale keeps the name it was sent under — and a method a sale points at can't be deleted;
rename it instead.

**My shipping can be in any currency.** Postage is often paid in your own currency, not the
marketplace's, so the shipping row has its own currency selector (defaulting to the sale currency).
Whatever currency you pick, the cost is converted **straight to your base currency** at the rate on
the sale date, and it's the base amount that feeds profit. The row shows the base equivalent beside
a foreign-currency amount (or flags **no rate** if none is known yet). Because shipping lands in the
base currency, the **net proceeds** figure — on the sale, its rows, and the list — is shown in the
**base currency**. For a single-currency collection (base = sale currency) nothing looks different.

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
  keeps it **Active** for its remaining sets.
- Any **other active offer** — on another platform — holding a set with a copy you just sold is
  flagged **Needs action**, so you can take those stale listings down. See
  [keeping platforms in sync](offers.md) on the Offers page.

The shared amounts are split across the sold units in proportion to their sale prices, and each
unit's net is converted to your base currency at the frozen rate — this feeds per-item
profit/loss (surfaced with the profit/loss views).

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

**Moving to Sent asks about the parcel.** The moment it goes is the moment you know which courier
took it and hold the receipt with the number on it, so a **Mark as sent** prompt asks for both. The
carrier arrives **pre-selected** from the sale's shipping method — change it when the parcel went
another way — and the prompt says what the choice means: whether that carrier will turn the number
into a link, or whether it has no tracking page recorded. **Skip** moves the sale to Sent without a
number, which is the right answer for postage that carries no tracking at all. As with the paid
prompt, a sale that already has a tracking number isn't asked again.

## Tracking the shipment

A sale records **who carried the parcel** and its **tracking number** — the number free text,
exactly as the carrier gave it to you. Both live in one **Shipment** dialog: it opens at the
[**Sent** transition](#fulfillment-status), and again from the detail header — **Add tracking
number** when there is none, or the **✎** beside the 📦 chip to correct what was recorded. Like the
transaction link, either can be set or changed whatever the sale's status is.

**The carrier on a shipping method is only a default.** On a marketplace you offer a *service* —
"Courier" — and which courier actually takes the parcel is settled at the counter, so what the
method names is a suggestion the Shipment dialog pre-selects and you override per sale. A sale that
never says anything of its own keeps following its method's carrier.

Whether the number becomes a **link** depends on that carrier:

1. Add the carrier under **Settings → Shipping** with its **tracking address** — the page where it
   looks a parcel up, with `{code}` where the tracking number goes, e.g.
   `https://emonitoring.poczta-polska.pl/?numer={code}`. Leave the address blank for a carrier with
   no tracking page.
2. Name a usual carrier on the platform's [shipping method](contacts.md#shipping-methods), so the
   common case needs no thought.
3. Record the sale, pick the carrier that actually took it when you mark it Sent, and the tracking
   number becomes a **📦 link** straight to the parcel.

Without a carrier — or with one that has no tracking address — the number is still recorded and
shown, just as plain text; hover it and the chip says which of the two is missing. Because the link
is built when the sale is read rather than stored on it, a carrier that moves its tracking site is
corrected in one place and every sale it ever carried follows.

## Packing view

The detail screen doubles as a **packing list**. Each sold set is a collapsible card (expanded
by default — deliberately unlike the lot and set cards on the [purchase](purchases.md), [offer](offers.md)
and [auction sale](auctions.md) screens, because a packing list is there to be read, not scanned)
whose header shows the set, its copy count, price, and net. Expanding it shows the
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

Any sold unit's **⋮** menu carries **Choose set**. It lists the sets of that unit's own offer that
are still available and marks the one the line names today with **On this line now** — including
when there is only one, since what you came to see is which set this line is standing on.

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
of the interchangeable sets without anybody deciding. The chip is the button as well as the flag:
press it and the picker opens, so you never have to go looking for the menu.

On a sale holding such units the toolbar above them grows a **Set** filter — **All** / **Not chosen
(N)** — so you can narrow the sold units to exactly the ones still waiting on you and work through
them without scrolling past the settled ones. It appears only while something is actually waiting,
and stands down by itself once you have settled the last one. Like **Packed** beside it, it narrows
what is listed and changes nothing.

The same chip appears on that sale's row in the sales list, where a **Set not chosen** filter narrows
to the sales still waiting — that one answers *which parcels* need attention, before you open any of
them.

## Printing a packing list

If you'd rather pack from paper than from the screen, the header's **🖨 Packing list** button opens
a print-friendly sheet for the sale. It is a plain document — no sidebar, no controls, no filters —
laid out as a walk through your shelves:

- A **header** carrying the **sale's own number** (`Packing list #12`) — this collection's name for
  the transaction, and the reference to quote when the sheet is talked about on paper — plus the
  platform, buyer, order number, sale date, [status](#fulfillment-status), and the copy/packed
  counts. The **order number** beside it is a different thing: that one is the *marketplace's*
  number for the same sale. When the sale records a **shipping method**, it prints there too, so
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

Each printed page carries a line at its foot that identifies the sale on its own — the **sale
number**, **platform**, **buyer**, **order number**, **sale date**, the **copy count** and the
**status** — next to
**Stamporama** and its version, the collection, and the date and time the sheet was **generated** —
in your own timezone, not the server's, so it reads as the clock you printed it by.
So a page that slips out of the stack can still be matched back to its order, two printouts of the
same sale can be told apart, and a sheet found weeks later says where it came from. The note about
the tick boxes closes the document, after the last row.

**Page numbers** come from the browser, not from the sheet: tick **Headers and footers** in the
print dialog and every page is numbered (the dialog also adds the date and the page title there).
Browsers don't render page numbers that a web page asks for itself, so this is the one setting the
packing list can't set for you — the screen reminds you of it above the list.

Click **🖨 Print** for your browser's print dialog (or print/save as PDF from the browser menu).
The sheet always prints in light colours, even if you use the dark [theme](appearance.md).

## Deleting

From a list row's **⋮** menu you can **delete** a sale — that removes the record, makes its copies
available again, and returns any offers it marked sold to **Active**.

## Finding a sale

Each sale carries its own **number** (`#7`), shown on the row beside the fulfillment status. It is
the collection's own number for the sale, separate from the marketplace's order number that appears
after the platform name — type `s 7` in the sidebar's **Jump to…** box to go straight to it
([Quick jump](quick-jump.md)).

The Sales toolbar has a **search** box, a **platform** filter and a row of **status** chips.
Search matches the buyer name, the platform name, the order number, and the **name or catalog
number of any copy** sold on the sale — so you can find a sale by what was in it, not just who
bought it. The platform dropdown narrows the list to a single marketplace, and the status chips to
particular [fulfillment steps](#fulfillment-status). All three combine.

The status chips are **multi-select**: click as many as you want and the list shows all of them
together, so "everything Paid *or* Packed but not yet Sent" is one selection rather than three
passes. Clicking an active chip again drops it, and clearing them all shows every status.

The chips you picked are **remembered** for this collection and re-applied the next time you open
the screen; a status named in the URL wins over them, so a link you share always shows what you
meant it to.

## Related

- [Offers](offers.md) — the listings (and their sets) a sale is recorded against.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used for profit/loss.
