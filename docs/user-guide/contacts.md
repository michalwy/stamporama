# Contacts

**Contacts** are the address book of the people and firms you deal with as a collector — sellers,
buyers, exchange partners and auction houses. Contacts are scoped to a collection: each collection
keeps its own list. The marketplaces you trade through — Allegro, Delcampe, Facebook, eBay — are not
contacts but [platforms](platforms.md), configured in Settings.

Open the **Contacts** screen from the **Partners** section of the sidebar — it sits below
**Selling** and **Intake** rather than inside either, because the same address book serves both.

## Roles

A contact can carry any combination of **roles**, or none at all:

- **Seller** / **Buyer** — someone you buy from or sell to.
- **Exchange partner** — someone you swap stamps with; the partner a [trade](trades.md) is made with.
- **Auction house** — e.g. Cherrystone, David Feldman.
- **Other** — anyone who doesn't fit the above.

Roles are just labels: they show as badges on each row and let you filter the list. A
contact created automatically while recording a purchase starts with no roles — open it
and tick the ones that apply.

## Adding and editing

Click **Add contact** and fill in the **name** (required), optional **full name**, **email**,
**phone**, **Facebook profiles**, **notes**, and the **roles**. Names must be unique within the
collection.

**Name** is who they are *to you* — what you file them under and what every picker searches.
**Full name** is the name on the paperwork, and only needs filling in when it differs. That is the
ordinary case for a marketplace buyer: you know them as `bronek_1980`, and the parcel has to say
*Bronisław Włoch*. Recording a sale from an [Allegro order](allegro.md) fills it in for you, on a
contact that has none.

**Facebook profiles** are the links to the person's profiles. They are how the buyer of a
[Facebook offer](facebook.md#selling-a-facebook-offer) — an auction's winner or a quick buy's buyer —
is recognised next time, since names repeat on Facebook; selling one to them fills the link in on a
contact that has none. Some buyers bid from more than one account: **Add profile** gives the contact
another, and a sale to any of them finds the same person. The **×** beside a link takes it off. Any
form of the link works — the phone's, the desktop's — and it is kept in one form. A profile belongs to
one contact only: a link another contact already has is refused, naming that contact. The contact's
row and its page link to every profile.

### Market

A **seller** or **auction house** has a **Market** — the country it sells in. It is
where its auction results count: a result from a German house is evidence for areas that anchor on
Germany and a hint everywhere else (see
[Markets — which results count](collections.md#markets--which-results-count)). Left as *not known*,
its results count by the [platform's market](platforms.md#the-platform), and failing that as the
collection's home market. A price observation takes its house's market, or its platform's when there
is no house; one of your own lots takes its sale's seller's, or the sale's platform's. Changing it
re-judges every result already recorded — nothing is stored on the results.

### Tabs follow the roles

A plain address-book contact is one short form. Tick **Seller** or **Auction house** and the dialog
grows a second **tab** for what that role brings with it:

- **Contact** — name, full name, email, phone, Facebook profiles, roles, market and notes. Always there, and where you land.
- **Auction defaults** — the currency and fee terms a seller trades on.

The tabs are **grouping only**: it is still one record with one **Save changes**, and what you typed
on a tab you are not looking at is saved with everything else. Untick the role and its tab goes, along
with the settings it held — which is how you clear them.

Ticking **Seller** or **Auction house** reveals **Auction sale defaults** — the **currency**,
**shipping**, and the two **buyer's premium** parts (a percentage and a per-lot fee) this seller
normally trades on. They are **copied onto every new [auction sale](auctions.md)** with this seller
and are edited on the sale afterwards, so raising a premium here never re-prices a parcel you are
already bidding on. Currency sits on the seller rather than the platform because an aggregator
carries houses listing in EUR, CHF and GBP alike.

A seller also quietly remembers **which platform you last tracked a lot with them on**, and it
pre-fills the platform next time you name them. There is no field for it — it is written whenever
you add a lot or start an auction sale, and deleting the platform simply forgets it.

Every contact row has a **⋮** menu with **Edit** and **Delete**. **Edit** is also the pencil icon
beside the menu, so the most common change is one click away. Editing replaces all the details and
roles with whatever the dialog shows when you save.

## A contact's page

Click a contact's row to open its **page** — what you have done with that person or company. ⌘- or
Ctrl-click, or the middle button, opens it in a new tab.

The top of the page says **who** the contact is: the name, full name, roles, email, phone,
Facebook profiles, market and notes. **Edit** opens the same dialog as the row's pencil, and
**Merge with…** makes this contact and another one into one (see [Merging two contacts](#merging-two-contacts)).

Below it, a **period switch** — **This year**, **Last 12 months** or **All time** — narrows every
figure on the page. *All time* is where a page starts; the period you pick is remembered for the
collection, so the next contact you open is read over the same one. *Last 12 months* runs up to and
including today.

Then one section for each part the contact plays:

- **Purchases** (the contact as **seller**) — how many purchases, the **total spent** (each order's
  total: its lots, expenses, packing supplies and shipping), the **share of catalogue** paid across them, the
  **copies bought**, the **last purchase**'s date and how many purchases are **not yet delivered**
  (*Preparing* or *In transit*). The trades you made with the contact are not purchases and are not
  counted here.
- **Sales** (the contact as **buyer**) — how many sales, the **revenue** (what the buyer paid: the
  prices plus any handling they paid, before commission and your own shipping), the **copies sold**,
  the **last sale**'s date, and how many sales are **not yet paid** (*Ordered*) and **not yet sent**
  (anything before *Sent*).
- **Auctions** (the contact as the **seller or auction house** you track auction sales with) — how
  many **sales** and **lots** you tracked, how many lots you **won**, **lost** and saw **cancelled**,
  your **win rate**, what you **spent on won lots**, and the **buyer's premium** on the sales. Under
  them, what is **still running**: the **open lots**, what they have **committed** you to and what
  they would cost **at ceiling** — the two figures the auction lots list states above its rows — and
  how many lots are still **to review** after the assistant wrote them.
- **Trades** (the contact as **exchange partner**) — how many [trades](trades.md) you made with them,
  how many are still **open** (*Preparing*, *Shared* or *Agreed*), and the **value given** and
  **value received**, in **My valuation** — the same figures the trade's own screen totals, in your
  base currency. A **cancelled** trade is counted and listed, but nothing went either way, so its
  value is left out. A line with no value is never counted as zero: it is left out of the total and
  the figure says how many lines that is. A trade belongs to the period it was **started** in.

The Purchases, Sales, Auctions and Trades sections end with the list of their purchases, sales,
auction sales or trades in the period, and a row opens that one. An auction sale's row says how many of its lots are open, won and lost; a trade's
row shows the pieces going each way and its value each way.

A section shows when the contact has the **role**, or when there is **something to show** for it — so
a supplier created while recording a purchase, which has no roles yet, still shows its purchases.
The auctions section is the one exception: the **Seller** role alone does not bring it, since most
sellers are never bid with — an **Auction house**, or any seller with an auction sale tracked, has
it. Switching the period never hides a section, only empties it.

### Auctions on the page

An auction sale belongs to the period it was **tracked** in, and all of its lots with it — so the
sales listed and the figures above them always add up. The **open lots**, **committed**, **at
ceiling** and **to review** figures are different: they are what is running **now**, whatever the
period, and they match the auction lots list exactly.

- The **win rate** is the lots you won out of the lots that closed **with your bid on them** — won
  and lost. A lot you only watched, without bidding, and a cancelled one count as neither.
- **Spent on won lots** is each won lot's hammer price with the sale's premium on it, plus each
  sale's shipping **once** — what the sale's own screen states for the lots you won. It is in the base
  currency at the rate recorded when each result was entered.
- The **buyer's premium** lists the terms on the sales in the period. A sale takes them from the
  contact when it is tracked, so if the terms changed, both are listed, newest first.

**Every figure opens the list it counts**, narrowed to this contact: the purchases list by supplier,
the sales list by buyer, and the not-delivered, not-paid and not-sent figures by those statuses too.
An auctions figure opens the **auction lots list** for this seller — won, lost, cancelled or open on
the matching outcome, and the totals with **Show closed** on, so the closed lots are there too.
A partner's figures open the trades list on that partner, and **Open** on the three open
statuses too. The lists are not narrowed to the period — they show everything with this contact. The
date of the last purchase or sale opens that one.

### Money on the page

Money is stated in the collection's **base currency**, so purchases and sales in different currencies
add up. Where every one of them was in the same other currency, its total is shown beside it.

A purchase or sale in another currency with **no exchange rate** recorded cannot be stated in the
base currency, and then the page states **no base total** rather than one that leaves it out — hover
the figure to see how many are why. The share of catalogue is read the way a purchase's own screen
reads it: `~` marks an estimate while lots are still open, and **at most** an upper bound while some
of their copies have no catalogue price.

### The conversation log

At the foot of the page, the **Conversation** card lists every entry of the log of conversations
with the contact, newest first, each naming the sale it is about where it has one — the same card a
[sale's screen](sales.md#the-conversation-with-the-buyer) shows, there narrowed to that sale. **Add
entry** records one by hand, and an entry's **⋮** menu edits or deletes it, or attaches files to it
— see [the conversation with the buyer](sales.md#the-conversation-with-the-buyer). Entries an AI
assistant wrote are marked *Assistant*.

## Finding a contact

Use the **search box** to filter by name, and the **role chips** to show only contacts of
a given role. The two combine — e.g. search "Jan" with the **Seller** chip active shows
only sellers whose name contains "Jan".

The search reads the **full name** as well as the name, so a buyer filed under their marketplace
login is still found by the name you remember them by.

## Merging two contacts

The same person sometimes ends up as two contacts — a buyer bidding on Facebook from a second
account, or a contact made twice by mistake. **Merge with…** on a contact's page makes them one.

Search for the other contact by name or full name. The dialog then shows the two side by side, with
the merged contact beside them, and you choose **which one remains**. The merged contact:

- keeps the remaining contact's **name** and every detail it already has — **full name**, **email**,
  **phone**, **market** — and takes the ones it lacks from the other;
- holds **both contacts' Facebook profiles**, so a later sale to either account finds it;
- carries **both sets of roles**;
- keeps its own **notes**, with the other's added under them;
- takes the other's **auction defaults** only if it has none of its own — a currency and its fees are
  one seller's terms, so they are never mixed from two.

Before you merge, the dialog says how many **purchases**, **sales** and **trades** — and any tracked
**auction sales**, **price observations** and **conversation entries** — of the other contact will
move. **Merge** moves every
one of them to the remaining contact and deletes the other; its name is not kept, since buyers are
recognised by their profile, not by name. The contact's page then counts them all together. There is
no undoing a merge.

You can merge from either contact's page: if the one whose page you are on is the one that goes, you
land on the merged contact's page.

## Deleting

A contact can only be deleted once nothing references it. If it is still used by one or
more **purchases** as their supplier, the **Delete** action is disabled
and the row shows how many purchases use it — detach it from those
[purchases](purchases.md) first. This keeps purchase history from losing who it was with.

Deleting a contact also deletes its [conversation log](#the-conversation-log), with the files
attached to its entries; the confirmation says so.