# Stamporama Assistant (browser extension)

The Assistant is a Chrome extension that connects marketplace pages to your collection while you
browse. On a Colnect list page it tells you which stamps you already have, which need a decision, and
writes the Colnect links back into Stamporama. On an **Allegro auction** it captures the lot you are
bidding on into your [watchlist](auctions.md).

It reads three kinds of Colnect page: a catalog **list** page, a single **stamp** page (its minor
variants), and the site-wide **search results** page — so a stamp you found by searching can be
matched without opening it first.

It is not part of the web app: you install it into Chrome once per machine, then connect it to your
instance.

## Installing it

The Assistant is published as an **unlisted Chrome Web Store listing** — not searchable, but
installable by anyone with the link:

<https://chromewebstore.google.com/detail/lhbaflbkfgahmcbgmlibleedmfcdjedf>

Click **Add to Chrome**. That is the whole installation: no settings, no policy, nothing per
machine.

Chrome keeps it up to date on its own, the same way it updates any other extension.

## Connecting it to your collection

Nothing is typed in, and no token is copied by hand:

1. Open the collection you want the Assistant to write to.
2. Go to **Settings → Assistant** and choose **Connect Stamporama Assistant**.
3. With that page still in front, click the Assistant's toolbar icon.

The connection appears in the extension's options, active and named after your collection. Repeat it
per collection, or per instance if you run more than one — the extension keeps them side by side and
shows the active one in a coloured badge, so it is always clear where a match will be written.

You can revoke a connection at any time from the same **Settings → Assistant** screen.

## Matching from an offer

The Assistant is usually started from a Colnect page you are already on. It also works the other way
round: an offer being prepared knows which of its stamps have no Colnect item-ID, and its **On
Colnect** card can hand them over one at a time — **⚡ Link** on a row, or **⚡ Link all** for the
whole gap. Each opens that stamp's Colnect search in a tab beside the offer and brings this window up
on it; you match as usual, and the item-ID appears on the offer screen without reloading it. See
[Filling the missing item-IDs](offers.md#filling-the-missing-item-ids-without-leaving-the-offer).

Those buttons only appear on an instance the Assistant is connected to — connecting is what lets the
extension read that page at all.

## Capturing an Allegro lot

Click the toolbar icon while an **Allegro auction** is in front of you and the Assistant opens a
small **Capture auction lot** window instead of the matching one. It has read the page already: the
title, the seller, the closing time and the current bid, with Allegro's **offer number** in the lot's
own number field and the listing's address recorded for you.

Everything shown is editable before it is saved — what a marketplace prints is a proposal, not a
fact about your collection. The seller in particular: Allegro shows a shop name, and you may well
file that seller under another name here. Correct it and the parcel is chosen for the name you typed.

Under the fields, the Assistant says what saving will do:

- **Joins the open parcel: Philkam · Allegro** — the seller already has a sale being bid on, and
  this lot goes into it, exactly as [Add lot](auctions.md#adding-a-lot) would.
- **New parcel: Philkam · Allegro** — the seller has no open sale, so one is started with their own
  premium and shipping copied onto it.
- **Already watched — the bid will be refreshed** — you have captured this listing before. Saving
  records the new bid and the moment you checked it, and touches nothing else you have typed onto the
  lot. That makes the toolbar icon the fastest way to bring a price up to date.

Two rules are worth knowing, because they are deliberate:

- **Only auctions.** A *Kup teraz* offer is refused, in as many words. The watchlist is for things
  that are being bid on and close at a known moment; a fixed-price offer has neither, and you would
  be tracking a lot that never ends. Buy it and record it as a [purchase](purchases.md).
- **What the lot holds is never read off the listing.** The stamps a lot contains are entered in
  Stamporama, on the lot itself. A description cannot be turned into `stamp × condition × quantity`
  reliably, and a composition that is quietly wrong is worse than one you have not written yet — it
  is what every catalogue figure and every headroom is computed from.

Before the first capture, tell Stamporama **which of your platforms is Allegro**: **Settings →
Allegro**, one select. That is the one thing an auction page cannot tell the Assistant — the page
knows it is Allegro, but not which of your [contacts](contacts.md) that marketplace is. Until it is
set, the capture window says so and saves nothing.

That select is about a marketplace you *buy* on, and it is all the capture needs. Connecting the
Allegro account you *sell* from is a separate, optional step on the same tab — see
[Allegro](allegro.md).

## Closing the window

The Assistant opens in its own small window — the matching one and the capture one alike. **Escape**
closes it, or, while a confirmation is on screen, cancels that first and leaves the window open.
Nothing is lost either way: a confirmed write reached your collection the moment you confirmed it,
and the page is read afresh the next time you click the toolbar icon.

**Write auto-matches** closes the window for you. It asks nothing first — the button already names
exactly what it will do (*Write 8 auto-matches + 3 catalog numbers*), and an auto-match is one the
matcher had no doubt about — then writes and closes as soon as your collection has answered, leaving
you back on the page you were reading. It sends only the matches it just named, so writing one match on
a page of two hundred stamps takes about as long as writing one on a page of one. The two writes that really are a decision still ask: linking one
of several candidate stamps, and [replacing a catalog number](#when-colnects-number-disagrees-with-yours)
you already hold.

**Save** in the capture window closes it the same way, as soon as the lot has reached your
watchlist. There is nothing more to do here — what the lot holds is written in Stamporama, on the lot
itself — and the listing you were reading is right behind the window. A save that *fails* leaves the
window up, with your corrections still in the fields and the reason on screen.

## Decisions that are already made

The Assistant never silently replaces a Colnect ID you already have. So when one of your stamps is
linked to a *neighbouring* Colnect item, that stamp keeps coming back under **Needs your decision**
every time you re-scan the page — even though you settled it long ago.

Those rows are hidden by default. A row disappears only when **every** stamp it could be linked to
already carries a Colnect ID; if one of the candidates is still free, the row stays, because that
free stamp is most likely the answer.

When there are hidden rows, a **Show N already linked elsewhere** checkbox appears beside *Fill
missing catalog numbers* — tick it to bring them back and change one. It only filters what is on
screen (nothing is re-matched), and the extension remembers the setting.

## When Colnect's number disagrees with yours

Matching a stamp also compares the catalog numbers on both sides. Numbers Colnect lists for catalogs
your stamp has none of are added for you — that is the **Fill missing catalog numbers** tick box, and
it is the whole of what a match writes to your numbers by default. A catalog where the two sides
carry *different* numbers is only reported: a match is not evidence that yours is the wrong one.

When you look and decide Colnect is right, the row says so and offers the change:

> `Mi·PL 3690` → `Mi·PL 3691`  **Use Colnect's**

Clicking it replaces that one number, on that one stamp, after a confirmation naming both values.
Nothing else moves — your other catalogs, and the Colnect link itself, are untouched — and once it is
written both sides show the number as agreeing.

It is offered only where the window knows which stamp it is talking about: a stamp already linked to
the item, or a row with a single candidate. A row still offering you several stamps to choose between
has not settled which one this is, so there is nothing to correct yet — pick the stamp first.

Two things it will not do:

- **Store a number it cannot read as yours.** Colnect prints numbers with a country code (`PL 3691`)
  and you store them bare (`3691`) under an area that knows the prefix. If your area sets no prefix
  for that catalog, or Colnect's prefix is another area's entirely, no button appears — the same two
  cases where a missing number is not filled in either.
- **Quietly create a [duplicate catalog number](duplicate-catalog-numbers.md).** If the new number is
  one another stamp already holds, the collection's own rule decides: under *block* the change is
  refused and the other stamp is named, under *warn* it is made and the collision reported.

## Filling a sale form for you

The Assistant also works the other way round: **⚡ List via Assistant** on a ready offer — in the
[bulk listing workspace](offers.md#list-via-assistant) or in the offer's own header — opens the
platform's sale form in a new tab and fills it in — the items being sold, each copy's condition in the
platform's own grades, the price, the number of sets and the two texts.

On Allegro it also fills the **category's own parameters** and the delivery, handling time and
returns from the offer's [listing profile](allegro.md#listing-profiles) — everything the **On
Allegro** card on the offer shows.

It **never submits**. The form is filled and left in front of you to check and post yourself. When it
is done, the offer's card in Stamporama lists what was filled and what was skipped, so a field it
couldn't answer — a condition with no grade on that platform, a text over the platform's limit — is
something you learn there rather than after posting.

### Going back to a listing that is already live

An **Active** offer's header carries **⟳ Update via Assistant** instead, which opens the *edit* form of
the listing the offer is already posted as and re-fills it the same way. Everything is reloaded from
the offer whether or not it changed, and the listing's pictures are **replaced** with the offer's
current set rather than added to. Saving changes nothing in Stamporama — the offer was already live.

Colnect serves the same form at an edit address, so its listings can be updated this way; Allegro's
cannot, and is corrected on Allegro's own screen. The details are in the
[offers guide](offers.md#update-via-assistant).

### Allegro's form is a longer walk

Colnect's sale form is at an address, and opening it is the whole of getting there. Allegro's is not:
it answers that address with its newer step-by-step form, whose *"dotychczasowy formularz"* link
leads to a product search that has to be run before Allegro will offer to continue without a
catalogue product — and only then does it ask for the category.

The Assistant walks all of that itself, and the one thing it types on the way is the offer's own
**category number**, which is what opens the form in the right category. You do not choose a product
from Allegro's catalogue at any point: your stamps are not in it, and a listing filed against
somebody else's product is not what the offer says it is.

What it fills once it is there, and the three things it leaves to you, are in the
[Allegro guide](allegro.md#listing-through-the-assistant).

Colnect sometimes answers the sale form's own address with a short **"checking your browser"** page
that reloads itself into the real form a moment later. The Assistant waits that page out: it fills the
form once the form is actually there, rather than filling the interstitial and reporting a listing
that is blank in the browser. If the page never turns into the form — a sign-in, a challenge you have
to solve yourself — it gives up after a few seconds and says so; deal with the page and hand the offer
over again.

### The pictures go in too

Your offer's rendered images are attached as the **last** step, once every other field is in: the same
set, in the same order, under the same file names as the offer's ZIP — what you marked do-not-publish
and anything past the platform's photo limit are left out here exactly as they are left out there.

They go in last on purpose. Colnect uploads a picture the moment it is handed over, before the sale is
saved, so nothing reaches the marketplace until the filled form is in front of you. You will see the
thumbnails appear in Colnect's own uploader — that, rather than the report, is what says they arrived.

If some of them can't be attached, the report says which and why, and the rest of the filled form is
left alone: download the offer's ZIP and drag the missing ones in. The common reasons are that the
offer's pictures haven't been generated in Stamporama yet, or are still rendering.

### When you post it, the offer goes live by itself

Press the platform's own Save and the Assistant reads the listing's own address off the page it lands
on, and hands it back. The offer then moves **Ready → Active** in Stamporama, with its listing date
stamped and that URL recorded — the field that goes stale first if it is left to be pasted in later.
The report strip says so and links to the live listing.

It closes the loop even if you have moved on: the offer is activated whether or not the Stamporama tab
that started the listing is still open, or still showing that offer.

Two things it deliberately doesn't do:

- **A form you abandon changes nothing.** Close the tab, or walk away from it, and the offer stays
  Ready exactly as it was. Nothing is posted, so nothing is recorded.
- **A listing whose URL can't be read is reported, not guessed at.** If you post one and the Assistant
  can't make out the entry's address, it says so — activate the offer here as usual, pasting the URL in
  or leaving it blank, which has always been an accepted answer.

For this to be offered, the connection has to be the one this instance is scripting: the Assistant
registers your instance's address when you connect it, which is what lets a page of yours hand an
offer over without any click on the toolbar. Connect it again from **Settings → Assistant** if the
button says it is not installed on a browser where it plainly is.

## Clickable Stamporama links

If you put the [`{offerUrl}` token](contacts.md) in a platform's **private note** template, your
listings carry a link back to the offer here. Colnect prints that note as plain text, so following
it would otherwise mean selecting the address by hand. The Assistant turns it into a real link on
the sale page — shown as the Stamporama mark and a label like **Offer #42** rather than a raw
address, opening in a new tab so you keep your place in the listing you were reading.

Only links to **instances you have connected** are turned into links; anything else in the note is
left as the text you wrote. That restriction is the point: an extension that made every address on a
page clickable would be handing you links it cannot vouch for. Both the short address and the longer
one older notes carry are recognised, so notes you posted before this existed work too.

Nothing to configure, and nothing changes on Colnect's side — the link is drawn in your browser
only, and only for you, since the private note is yours alone to see.

## Your own listings on Allegro

Open one of your own Allegro listings — from a sale notification, or just to check on it — and the
Assistant shows a small card in the bottom-right corner naming the offer it is here: **Offer #42**,
its state, and its title. Clicking it opens that offer in a new tab, so the listing you were reading
keeps its place.

On **Allegro → Moje Allegro → Sprzedaż → Mój asortyment** — your list of active listings — the same
answer appears once per row, as a plain **Offer #42** link right after Allegro's own `nr:` line. That
is where the row already says which listing it is, so it is where it also says which offer that is.
Filtering, sorting and paging the table redraw it, and the links follow. Hovering one tells you the
offer's title and state before you follow it.

The links are drawn in the **rows of that list** and nowhere else on the page. In particular the
search box above the table, which suggests your listings as you type, is left exactly as Allegro
draws it: what is being typed into is not a list being worked through, and a panel rebuilt on every
keystroke is no place for an answer.

Links appear **only** for listings your collection has an offer for. On everybody else's auctions —
the ones you are bidding on — nothing is drawn and nothing changes, and the toolbar icon still means
what it always did there: [capture the lot](#capturing-an-allegro-lot) for your watchlist.

How the listing is recognised: by Allegro's own offer number. If you have [connected the Allegro
API](allegro.md), the sync already knows which of your listings is which offer, and the answer is
exact. Otherwise it is found in the **listing URL** stored on the offer — which is filled in for you
when you post through the Assistant, and which you can paste in by hand on the offer's screen. An
offer with neither is not recognised, and the fix is to put the listing's address on it — a row of
the assortment list with no **Offer #…** link beside it is exactly that offer telling you so.

## Keeping it up to date

Nothing to do — Chrome updates it from the store. Each Stamporama release publishes a matching
version of the Assistant, which goes live once the store has reviewed it, usually within a day.
