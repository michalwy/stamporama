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

## Closing the window

The Assistant opens in its own small window — the matching one and the capture one alike. **Escape**
closes it, or, while a confirmation is on screen, cancels that first and leaves the window open.
Nothing is lost either way: a confirmed write reached your collection the moment you confirmed it,
and the page is read afresh the next time you click the toolbar icon.

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

## Filling a sale form for you

The Assistant also works the other way round: **⚡ List via Assistant** on a ready offer — in the
[bulk listing workspace](offers.md#list-via-assistant) or in the offer's own header — opens the
platform's sale form in a new tab and fills it in — the items being sold, each copy's condition in the
platform's own grades, the price, the number of sets and the two texts.

It **never submits**. The form is filled and left in front of you to check and post yourself. When it
is done, the offer's card in Stamporama lists what was filled and what was skipped, so a field it
couldn't answer — a condition with no grade on that platform, a text over the platform's limit — is
something you learn there rather than after posting.

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

## Keeping it up to date

Nothing to do — Chrome updates it from the store. Each Stamporama release publishes a matching
version of the Assistant, which goes live once the store has reviewed it, usually within a day.
