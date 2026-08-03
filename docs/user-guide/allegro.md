# Allegro

Stamporama talks to Allegro in two independent ways, both set up under **Settings → Allegro**.

- **Which platform is Allegro** — the setting the Assistant's lot capture rides on. Naming one of
  your platforms lets the browser extension record an auction you are watching straight from its
  page. See [Auctions](auctions.md) and the [Assistant guide](assistant.md).
- **Your Allegro account** — this instance's own access to Allegro's API, so your *own* offers and
  orders can be read here directly instead of off a page. That is what this page is about.

The two are separate on purpose. The first is about a marketplace you buy on; the second is about
the account you sell from.

## What connecting gives you

Two things. The **Sold on Allegro** worklist — see below — and **automatic bid tracking**: an
auction of yours that somebody bids on is marked **In active bidding** by Stamporama itself, within
a couple of minutes, with the standing bid kept current. Connecting itself ends at *connected* and
reads no business data.

## Registering your own Allegro application

Stamporama is self-hosted, and it deliberately ships with **no Allegro application of its own**. A
client ID and secret baked into a public image would be one shared application for every
installation in the world — revocable by anyone, and rate-limited as a single caller. So your
instance uses an application you register yourself. It is free and takes a few minutes.

1. Sign in at [apps.developer.allegro.pl](https://apps.developer.allegro.pl) with the Allegro
   account you sell from.
2. Create a new application.
3. Choose the type:
   - If your Stamporama has **no public address** (it runs on your own machine, a home server, a NAS
     — anything you reach over your LAN or a VPN), pick the option for an application that signs in
     **without a redirect** — Allegro calls this a device / non-web application. This is the normal
     case.
   - If your Stamporama **does** have a public HTTPS address, you may instead register a web
     application and give it the redirect URI shown on the Settings → Allegro tab. It must match
     exactly, character for character.
4. Grant it read access to your offers and orders. Profile access is **optional**: without it
   everything works, Stamporama just cannot show which Allegro account is connected — the tab then
   says "Connected" without a name.

   What you tick here is exactly what the connection can do — Stamporama asks for no permissions of
   its own, so the access you grant is the access it gets, and nothing else. Grant narrowly; you can
   widen it later and reconnect.
5. Copy the **Client ID** and **Client secret**.

### Before you paste them in: the encryption key

Allegro credentials are stored **encrypted**, so a database dump — a backup, a copy taken to another
machine, a file you send someone for help — does not carry live marketplace credentials in the
clear. The key comes from your environment, not from the database.

**If you installed with `scripts/install.sh`, you already have one** — the installer generates
`STAMPORAMA_SECRET_KEY` into your `.env` and never changes it afterwards. Skip ahead.

Otherwise, generate one:

```bash
openssl rand -base64 32
```

Put it in your `.env` as `STAMPORAMA_SECRET_KEY` and restart Stamporama. Until you do, the Allegro
tab will say so and refuse to save an application.

Two things worth knowing:

- **Back it up with your database.** A database restored without its key still has all your stamps,
  offers, sales and photos — only the Allegro connection is unreadable.
- **Changing it loses the connection and nothing else.** You reconnect from Settings; you do not
  re-register the application.

## Connecting

Open **Settings → Allegro**, fill in the client ID and secret, tick **Use Allegro's sandbox** if you
registered a sandbox application, and press **Save application**.

Then choose how to sign in.

### Connect with a code (recommended)

Press **Connect with a code**. Stamporama shows a short code and a link. Open the link in your own
browser, sign in to Allegro if you are not already, and enter the code. The Settings page is
watching and finishes on its own — you do not need to come back and press anything.

This works on every installation, including one that nothing on the internet can reach, because
Allegro never has to send your browser back to Stamporama. It is the recommended path for that
reason.

The code is good for a few minutes. If it expires, press the button again.

### Sign in on Allegro instead

Offered only when your instance has a configured address (`BETTER_AUTH_URL`). Pressing it sends you
to Allegro, you confirm, and Allegro sends you straight back to the Settings tab, connected. It is
one round trip rather than a wait — but it needs the redirect URI shown on the tab to be registered
with your application, exactly as printed.

## Once connected

The tab names the Allegro account you are connected as — or just says "Connected", if the
application has no profile access — along with when its token was last refreshed and when it
expires. Tokens are renewed automatically before they run out, and they survive a
restart — you connect once.

- **Test connection** makes one real call to Allegro and reports what came back. If the application
  has no profile access it says so and still counts as working — Allegro accepting the token is the
  thing being tested, and that is a different answer from Allegro refusing it.
- **Needs reconnecting** appears when Allegro has refused to renew the connection — typically
  because you revoked it in your Allegro account, or the application's secret changed. Press
  **Reconnect with a code** and go through the short flow again.

### Changing the application

Saving a different client ID, or switching the sandbox toggle, **drops the current connection**: an
access token belongs to the application that issued it. Reconnect afterwards.

Leaving the client secret field blank keeps the secret you already saved — it is never shown again
once stored, so a blank field means "keep it", not "clear it".

### Disconnecting

**Disconnect** forgets the connection here. It does not remove the authorization on Allegro's side
— your application stays listed under your Allegro account's connected applications until you remove
it there. If your intent is to cut access off entirely, do both.

## Sold on Allegro

Once connected, **Offers → Sold on Allegro** shows what has sold and is still waiting to be written
down. It is a worklist, not a search: rows leave it as you record the sales, and it fills itself
again in the background.

Stamporama checks for **new orders and new bids every two minutes**, and reads your whole account
every 15 minutes — the second is what notices a listing that has quietly ended, since that can only
be told from a complete read. **Sync now** runs the full check immediately.

### Sold, awaiting sale

One card per Allegro order, with the lines it covers. A card carries:

- whether the buyer has **paid** yet — an unpaid order is still shown, because recording the sale at
  *ordered* is a legitimate thing to do;
- when it was bought, and when Stamporama last saw it;
- **who bought it** — their Allegro login, with their name or company beside it where the order
  states one. Nothing else about the buyer is read: the email, phone number and delivery address on
  an Allegro order stay on Allegro until you actually record the sale;
- **what they paid in total**, at the right of the card. This is Allegro's own figure, so it
  includes delivery — it is what changed hands, not the sum of the goods;
- the offer here it belongs to, if it could be worked out.

Four chips narrow the list: **Paid** / **Not paid**, and **Matched** / **Unmatched**. They are two
separate questions, so you can combine them — *Paid* + *Unmatched* is the pile most worth clearing
first. Leaving an axis untouched means it is not asking. The numbers on the chips always count the
whole list, not what the other chips have left, so they tell you what is there to filter to.

**Record sale** opens the same sell flow the offer's own screen uses. Nothing is written until you
save it — the sync never creates a sale, a payment or a contact on its own.

A card disappears once a sale exists carrying that order number as its transaction reference. That
is also why one order can never turn into two sales.

Where the order's offer is **already on a sale**, the card says so directly — *Looks like sale #12 —
link* — and one click connects them. Stamporama works that out rather than searching for it: the
line matched an offer, and that sale's lines name the same offer. It only offers this when exactly
one sale fits and that sale has no order number of its own; an offer sitting on two sales, or an
order pointing at two different ones, proposes nothing, because there the data says two things and
the choice is yours.

It is always a click. Nothing is linked on your behalf: a guess that emptied the row by itself would
take the signal away exactly when the guess was wrong.

**Link to existing sale** — *choose another*, where a proposal is showing — is for the sale you
already recorded — before the sync
existed, or because you write sales down as you pack. It offers the sales near this order's date
that carry **no order number yet**, showing the date, the total and the buyer so two similar ones can
be told apart, and writes the order number onto the one you pick. Nothing else about that sale is
touched: not the amounts, not the buyer, not the lines. A sale that already names an order is never
offered and never overwritten, and an order some other sale has already claimed is refused by name.

It is the same key either way, so you can still do it by hand — open the sale and paste the number
into **Order number** — and the row leaves the list just the same.

**Unmatched** means no offer in this collection could be tied to that Allegro listing. It is shown
rather than hidden, because it tells you something: the listing was posted outside Stamporama, or
its URL was never recorded on the offer here. Two things fix it —

- paste the listing's address into the offer's **Listing URL** field, or
- publish through the Assistant, which stores the address for you.

The listing is matched on Allegro's own offer number inside that address, so any of Allegro's URL
shapes works — the canonical `allegro.pl/oferta/<number>`, one with the listing's name in it, or a
product page carrying `?offerId=`. The number is in the row itself, as the **offer …** link.

**You do not have to re-import anything afterwards.** Every pass gives the rows that matched nothing
another go against your offers as they are now, so filling the URL in takes effect on the next sync
— within a couple of minutes, or immediately with **Sync now**, which then says how many rows it
matched.

A row that matched the *wrong* offer is a different situation, and the sync will not change its mind
about it — a match already made is something you may have acted on. Correct the offer, and record
the sale from the offer's own screen.

### Ended without selling

Listings that are no longer up on Allegro while the offer here is still live. Nothing sold, so there
is no sale to record — what is out of date is the offer's own state, which is why these sit in their
own section. Open the offer and withdraw it, or put it back up.

### When the list cannot be trusted

The header always says when the list was last refreshed. It also says, in plain words, when it is
**not** current:

- the collection is not connected to Allegro;
- the connection needs reconnecting;
- no platform here is marked as Allegro — nothing can be matched to an offer, so every line reads as
  unmatched;
- the last sync failed, with Allegro's own message and how long ago;
- nothing has synced for over an hour.

A worklist that quietly looked fresh while going stale would be worse than no worklist, so none of
these is ever left to be noticed by their absence.

## Bids on your auctions

An auction listed on Allegro is checked for bids **every two minutes** — the same check that brings
in new orders — and it is the one thing here that changes something on your side.

The moment Allegro reports a bidder, Stamporama:

- marks the offer **In active bidding** — which flags every other active offer holding the same
  copies as **Needs action**, exactly as it does when you mark it yourself (see
  [offers](offers.md#in-active-bidding--auction-platforms)), so you know to pull those listings now;
- writes the **standing bid** into the offer's current price and stamps the **checked** date;
- records how many people have bid, shown beside the price as *"3 bidders"*.

It does this without asking. A bid commits you whether or not you have seen it, and a marker waiting
for your confirmation would be no faster than clicking it yourself. So that you always know it
happened, the auction appears in the notification bell under **Bidding started on Allegro**, and the
offer's own header says what Allegro reported and when.

Three things it will not do:

- **It never clears the marker.** Not when the auction ends unsold, not when a bid is cancelled, not
  when the listing is withdrawn. You pulled stock on the strength of that flag, so un-committing is
  yours to do: **Clear active bidding** from the offer's **⋮** menu. If a bid is cancelled, the
  offer simply says *"no bidders"* beside a marker that is still on — that disagreement is your cue.
- **It never copies the opening price into the bid.** An auction nobody has bid on keeps **No bids
  yet**; what it opened at is the starting price, which is yours.
- **It leaves quick-buy listings alone**, and any auction whose listing is quoted in a different
  currency than the offer keeps its typed figure — the marker still goes on, but Stamporama will not
  convert a price for you.

The worklist header says when bids were last checked, and says so plainly if that check is failing.

### What it does not do

- It never creates a sale, and never touches money.
- It never edits your offers, beyond the bid marker and the standing bid described above.
- It never creates a contact. The buyer's login is shown, not saved as somebody to write to.
- **Cancelled orders are left out entirely.** The sale did not happen, so there is nothing waiting.

## The sandbox

Allegro runs a sandbox that mirrors the real thing. A sandbox application is registered separately
and has its own client ID and secret, so switching the toggle means pasting the other pair in. It is
worth using while you are trying things out — nothing about orders or sales should first be
exercised against a live selling account.
