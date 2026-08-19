# Delcampe

Delcampe is a platform you **sell** on, and Stamporama prepares its listings the way it prepares
every other platform's: the title and description come from that platform contact's
[templates](offers.md#listing-title), the price and quantity from the offer, the photos from its
photo plan. What is different is how a listing gets there — Delcampe takes an uploaded file rather
than a form filled in by the browser extension.

Everything on this page lives under **Settings → Delcampe**.

## Which platform is Delcampe

The first setting on the tab, and the one everything else hangs off. Pick the contact you use for
Delcampe — it needs the **Platform** role (see [Contacts](contacts.md)) — and its currency, listing
templates and photo limits are set on the contact itself, exactly as for any other platform.

Only one platform can be Delcampe at a time. Naming it does **not** switch the
[Assistant](assistant.md) on: there is no Delcampe form for the extension to fill, so no
⚡ *List via Assistant* button appears on those offers, and none of the Colnect checks (a catalog
item-ID on every stamp, a mapped grade) is asked of them.

## Listing profiles

An upload row states a few things no offer knows about itself:

- **the shipping model** it is sent under,
- **how long and how often** the listing renews itself,
- which of Delcampe's **paid promotions** it buys,
- the **minimum bid step** it declares.

A **listing profile** is one answer to all four at once. One profile is the platform's *default* —
what every listing goes up with — and an offer can name a different one. That is what the second
profile is for: the standard letter for most lots, something heavier and tracked for the rest.

### The shipping model is a name, and it has to be exact

Delcampe's upload file names your shipping model **by its name**, and Stamporama cannot read your
list of models from Delcampe (that needs their paid API subscription, which this app does not use).

So type it exactly as it reads on Delcampe. If you rename a model there, uploads using that profile
will be **rejected by Delcampe** until you update the name here — there is nothing Stamporama could
have warned you about beforehand, and the rejection is not a fault in the file.

### Renewal

The defaults are shop-stock behaviour: the listing runs for **28 days** and renews up to **99
times**, which in practice means it stays up until it sells. *Re-buy the paid options on every
renewal* only means anything while one of the promotions is on — each renewal is charged again.

These two figures are what a **quick-buy** row carries. An auction takes its own, below.

### Auctions

An auction ends, so it is not shop stock. A profile therefore carries a second pair of figures —
**days the auction runs** and **times it may run again** — and any offer you have recorded as an
auction is uploaded with those instead of the renewal settings above.

Nothing is filled in for you. Every other default on this screen was taken from your own live
listings, and there were no auctions to take one from, so how long your auctions run is yours to
state. Until you do, an auction offer is **refused at export** and its **On Delcampe** card says so —
better than a listing that quietly renewed itself past the deadline that was its whole point.

The **closing day** and **closing hour** go into the file exactly as you type them. Which spelling
Delcampe's Easy Uploader wants for those two columns is not published anywhere Stamporama can read
and has never been confirmed, so put in what your own listings use and correct it if an upload
disagrees. Leave them blank and the auction simply closes when its duration runs out.

An auction row states your **starting price**, never what the bidding has reached. The current price
on an auction offer is an observation of the bidding; listing from it would state an opening figure
nobody offered. That is why an auction with no starting price is refused rather than listed at
whatever the price column happens to hold.

### Paid promotions

Bold title, background colour, border colour, promoted in lists, promoted on the home page. Each of
these **costs money on Delcampe**, and the upload file states a yes or a no for every one of them,
so they are set here rather than decided for you. All five are off unless you turn them on.

### Minimum bid step

Delcampe's listings declare a bid step that changes with the price — 0.01 on cheap items, 0.10 on
dearer ones. Where exactly it changes was never confirmed, so it is a setting rather than something
buried in the code: a **threshold price**, the step used **below** it, and the step used **at or
above** it. A listing priced exactly at the threshold takes the larger step.

The line under the fields reads the rule back to you in the form it will be applied. If you ever see
a Delcampe listing state a different step, correct the threshold here.

## Categories

Every upload row needs a **category number**, and it is not a setting: it is about the stamp.
Delcampe files a 1935 Polish used definitive somewhere quite different from a post-war one, and its
souvenir sheets somewhere else again.

So nothing is filled in up front. **Finishing an offer teaches it.** When you move an offer to
*Ready*, Stamporama remembers the category you uploaded for that stamp's area, year, condition and
subtype — and the next offer of that kind opens with the category already there.

A near miss is widened rather than refused: the same area and condition in another year first, then
another subtype, then one level up your area tree. The **condition is never widened**, because
Delcampe puts used and unused stamps in different categories by construction. Whatever it matched on
is stated on the offer, so a filled-in category is never a number you cannot account for.

The first offer of a kind has nothing to learn from, and that is the only time you pick one.

### Picking a category

The picker shows **Delcampe's own category tree** — Europe → Poland → 1944-…. Republic → 1961-70 →
Used stamps — so you can walk to where your stamps live. Opening it on an offer that already has a
category takes you straight to it.

Or search: `poland used 1961`. Every word has to appear somewhere in the category's path, in any
order, and the tree narrows around the matches rather than turning into a flat list — so you still
see where each one sits. A number typed in the same box works too.

The greyed-out rows are **places in Delcampe's tree, not categories** — `Europe`, `Poland` — and
cannot be chosen; open them and pick something underneath. A few rows are both: `Occupations` is a
category in its own right *and* has categories under it.

The list you are searching is **Delcampe's own**, read from the page Delcampe publishes it on.
Delcampe has no interface for this that Stamporama can use, so the list is fetched once a day and
kept locally. Settings → Delcampe says how many categories it holds and when it last read them, and
has a button to read them again — worth pressing when you have just set the instance up, since until
the first read there is nothing to search.

A **number you type is always accepted**, whether or not it is in that list. Delcampe's own selling
form is the authority; a category created since the last read still works.

### Correcting one

Two places, for two different mistakes.

On the offer: **Change category** picks a different one for this offer only, and **Match again**
throws that away and asks the register what it says now. Use the first when this particular lot is
the exception — a souvenir sheet among singles is exactly that.

Under Settings → Delcampe: the **Categories** panel lists what has been learned, and a row can be
pointed at a different category or forgotten. Use this when the *rule* is wrong rather than the one
offer. A re-pointed row starts its count again, since the new category is one nothing has been
uploaded into yet.

Rows already uploaded are never touched by either — Delcampe holds a listing's category from the
moment the file went up.

## Uploading a batch

Delcampe listings are created by uploading a file, and Stamporama builds it. On the
[Bulk listing](offers.md#bulk-listing--posting-a-prepared-batch) screen, with Delcampe picked as the
platform, **↓ Easy Uploader bundle** downloads one ZIP holding:

- `delcampe-upload.csv` — one row per offer shown, and
- every picture those rows name, loose in the same archive.

Unzip it, then hand Easy Uploader the CSV with the pictures beside it. Nothing has to be renamed or
rearranged: the `images` column names exactly the files that came out of the archive, in the same
order the offer's [photo plan](offers.md#generating-the-photos) puts them in.

The batch is **whatever the screen is showing** — the area and year filters on the left are how you
cut a session down, and the button exports that, not the whole platform.

Each row carries the offer's title and description, its price and quantity, the category on its
**On Delcampe** card, and the shipping model, renewal and promotion settings of the profile that
applies to it. An offer recorded as an auction goes out as one: its starting price, the profile's
[auction settings](#auctions), and the bid step for the figure it opens at. `personal_reference` carries the offer's own
[number](offers.md#offer-number-and-short-link) — only you can see it on Delcampe, it is short enough
to read at a glance in your own seller pages, and it is what lets Stamporama match the listing back
to this offer the first time you [read your listings back](#reading-your-listings-back). After that
the listing's own Delcampe id does the matching, so the reference is only ever needed once.

### Nothing is exported until every row can be written

If an offer in the batch cannot be turned into a row, **no file is produced** and the screen lists
what is wrong, one line per offer, linking to it. The usual reasons: no category yet, no photos
generated, no listing profile, a title over the platform's cap, an auction with no starting price, or
an auction whose profile does not yet say [how long an auction runs](#auctions).

That is on purpose. The file goes up once, and a row quietly missing from it is a listing that never
happened, sitting among the offers waiting for the next batch, looking exactly like them. Fixing the
list and exporting again is one pass.

Nothing is ever shortened to fit, either. A title over the cap is refused, not trimmed — a shortened
title is one nobody proofread.

### The title cap

Delcampe refuses a title past a certain length. Type that length into **Max title (characters)** on
the Delcampe platform contact (see [Contacts](contacts.md#listing-text-limits)). From then on a
counter appears wherever a title is written, an over-long title **cannot be marked Ready** — the
button says which text is over and by how much — and the export refuses one before building
anything.

Nothing is ever shortened for you. The wording is yours; cut it where you want it cut.

Leave the field blank if you do not know the number; nothing checks it until you do.

### How many listings you may have running

Delcampe caps how many sales you can have running at once, and the cap depends on the subscription
you hold. **Stamporama does not check it** and cannot: it never sees your Delcampe account, only the
offers here — listings end, sell and relist on Delcampe without this app hearing about it, so any
number it produced would be its own guess wearing the badge of a real limit.

Keeping a batch inside your package is yours to judge before you upload.

## Reading your listings back

Uploading a file tells Stamporama nothing. Until you bring an answer back, an offer you have just
listed still says **ready** here and has no link to its listing — which is why Delcampe's own
**active-items export** is the other half of the loop.

On Delcampe, go to your selling area and download the export of your **current sales** (the list of
what you have running). Then, under **Offers → On Delcampe**, press **↑ Import active items** and
pick that file.

What the import does:

- an offer that is in the file moves to **active**, gains Delcampe's own item number and a link
  straight to the listing;
- listings you had before and that are *not* in the file are reported as having **come down**;
- anything that could not be matched to an offer is listed with the reason.

The screen prints all of that as a report, and keeps the last two lists until the next import.

Do it whenever you want the state here to be true — after uploading a batch, and every so often to
catch what has sold or ended.

### Came down does not mean sold

A listing missing from the export has come down: it sold, it ran out, or you pulled it. The export
does not say which, so **Stamporama changes nothing about the offer** — it shows you the row and the
date the listing was last seen up, and recording the sale (or withdrawing the offer) stays yours.

### How a listing finds its offer

A listing Stamporama has already seen is matched on **Delcampe's own listing id**, which is unique
and never repeats — nothing else is consulted for it. A listing it is seeing for the first time is
matched on the **personal reference**, which is the offer's own number.

That reference has to be a number and nothing else. A listing you put up before you started
exporting from here carries whatever you typed into the field — a shelf reference, a note — and it
simply matches nothing, which is reported rather than guessed at.

### When two listings carry the same reference

Delcampe does not stop two listings carrying the same personal reference — uploading the same batch
twice will do it.

When that happens, **neither** listing is attached to the offer and both are reported. Nothing is
guessed: end or correct one of them on Delcampe, then import again.

The same goes for a listing whose reference names an offer number this collection does not have, and
for one carrying no reference at all — a listing you created directly on Delcampe, for instance. Both
are shown so you know they are there; neither changes anything here.

### What an auction brings back

For an offer you have recorded as an **auction**, the import also brings back what the bidding is at,
how many bids there are and when the listing closes — and raises the *in active bidding* flag the
first time somebody has bid, exactly as a bid on Allegro does.

A **fixed-price** offer's price is never overwritten. That figure is the one you set, and if the
listing disagrees with it, that is something to look at rather than something to have quietly
corrected in Delcampe's favour.

## Recording a sale from My Sold Items

The import above tells you a listing has **come down**; the sale itself is recorded from Delcampe's
own **My Sold Items** screens, with the [Assistant](assistant.md) installed and connected.

Open any of them — *To invoice*, *Invoiced*, *To send*, *Shipped*, *Archived*, or the whole list —
and each order row gains a small mark right after the line that says which order it is:

- **Sale #34** — a link. That order is already recorded here; clicking opens the sale in a new tab.
- **Import** — it is not recorded yet. One click records it.

So the question you actually have when you are packing — *have I written this one down?* — is
answered on the screen you are packing from, and answering it does not mean searching your sales list
for a buyer's login.

### What gets recorded

One order becomes one sale: its buyer, its date, its own order number, a link back to the order on
Delcampe, and one line per item, each matched to the offer it was here and priced at what that item
actually sold for. The sale opens at **Ordered**, like every sale — Delcampe's own phases are not
copied onto it, because that status is your record of what *you* have done with the parcel.

If the screen states the order's total exactly, it is recorded as [what the buyer
paid](sales.md#step-3--amounts), and your handling is worked out from it. The `± €13.95` figure
beside it is Delcampe converting into the currency your screen displays; that one is never used.

Pressing **Import** twice is harmless: an order already recorded answers with the sale it is, never a
second one.

### About the buyer, Stamporama keeps two things

The buyer's **login** and the **name printed beside it** — nothing else. The address on that row and
the e-mail behind *Contact the buyer* are not read, so they are never stored: Delcampe's e-mail is a
relay whose lifetime nobody here can check, and an address this app could never refresh is worth less
than no address at all. The buyer is filed under their login, so the next order from the same person
lands on the same contact.

### An order is recorded whole, or not at all

If any item on the order cannot be matched, **nothing** is recorded and the mark reads **Not
imported** — hover it for the reason, which names the item. The usual reasons:

- **No offer here carries this listing.** Something sold that Stamporama never listed, or listed
  before the [import](#reading-your-listings-back) taught it the listing's id.
- **That offer still has several sets for sale.** Two identical copies are listed as one offer, one
  sold, and nothing on the order says which — so it is not guessed.
- **Sold in another currency.** The row's price is not in the currency this platform's sales are in.
- **Delcampe states no amount.** A cancelled item prices the whole order at zero.

Record that one through the offer's own [sell flow](offers.md#selling-directly-from-the-list), and
press **Import** again for the rest — or leave it, since a sale recorded by hand is a sale.

The reason it is all-or-nothing: nothing is shown to you between the click and the record, and a sale
quietly missing a line looks exactly like a complete one while understating what you took.

## On an offer

An offer on the Delcampe platform carries an **On Delcampe** card on its own screen, under the
photos.

Once an import has seen this offer's listing, the card leads with it: the item number, a link to the
listing, and whether it is still up or has come down — with the date it was last seen up. That part
is not editable, because it is Delcampe's answer rather than a setting.

Below it are the two settings the next upload is built from: the **category** the row will be filed
under, with where that category came from, and which **profile** applies — the platform's default, or
one this offer names — with what that profile actually says: the shipping model, the renewal setting,
the bid step, and whether any paid promotion is bought.

Neither is a gate. Whatever the card shows is what the upload file will carry, and both are
correctable in place.

Changing the profile here affects this offer only. Editing a *profile* under Settings affects every
future upload that uses it and nothing already listed: Delcampe holds a listing's settings from the
moment the file went up.

## Deleting a profile

Nothing blocks it. Offers that named it fall back to the platform's default, and Stamporama tells
you how many did. If you delete the **default**, the platform is left without one — no other profile
is promoted in its place, because which settings your next upload carries is your decision.
