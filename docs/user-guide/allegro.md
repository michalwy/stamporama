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

Two things. The **Sold on Allegro** worklist — see below, where an order can be turned into a sale
in one reviewed step, buyer, amounts and delivery included — and **automatic bid tracking**: an
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
4. Grant it access:
   - **Read access to your offers and orders** — required. The sold-listing worklist and the bid
     tracking are both reads, and neither works without it.
   - **Write access to your offers** — only if you want to *publish* listings to Allegro from
     Stamporama. Reading works perfectly well without it; a connection granted read access alone
     simply refuses to create a listing, and says so.
   - **Profile access** — optional. Without it everything works, Stamporama just cannot show which
     Allegro account is connected — the tab then says "Connected" without a name.

   What you tick here is exactly what the connection can do — Stamporama asks for no permissions of
   its own, so the access you grant is the access it gets, and nothing else. Grant narrowly; you can
   widen it later and reconnect.
5. Copy the **Client ID** and **Client secret**, and note the **name** you gave the application —
   Stamporama asks for it too (see below).

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

Open **Settings → Allegro**, fill in the client ID, the application name and the secret, tick **Use
Allegro's sandbox** if you registered a sandbox application, and press **Save application**.

### Application name

Allegro asks every program talking to its API to say what it is, on every request — this becomes
mandatory at the end of June 2026. The point is contact, not gatekeeping: if something starts
misbehaving, Allegro would rather reach the owner than cut the application off.

So put in the name you gave your application on `apps.developer.allegro.pl`. Requests then identify
themselves as, for example, `StampSeller/0.60.0 (+https://github.com/michalwy/stamporama)`.

Leaving it blank is fine — requests then say `Stamporama` and the version, which still tells Allegro
what software is calling. Unlike the client secret, a blank field here means *no name*, not "keep the
one already saved": it is a label, not a credential.

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

### Permissions

Under the connection status the tab lists **what your application is actually permitted to do** —
read from the connection itself, not from what you meant to tick. It is the quickest way to answer
"why did that refuse?".

Publishing a listing needs your application to have **write access to your offers**. If it does not,
the tab says so plainly, and any attempt to publish is refused with the same reason rather than with
a general failure.

Two things about changing it:

- **You change permissions on Allegro, not here.** Stamporama asks for no permissions of its own —
  by design, because asking for one your application does not hold fails the whole sign-in with a
  message about something else entirely. What you granted at
  [apps.developer.allegro.pl](https://apps.developer.allegro.pl) is exactly what the connection can
  do.
- **A connection keeps the permissions it was made with.** Adding write access to the application
  does not widen a connection that already exists — press **Reconnect with a code** and go through
  the short flow again. Until you do, the tab will keep saying publishing is not allowed, and it
  will be right.

### Changing the application

Saving a different client ID, or switching the sandbox toggle, **drops the current connection**: an
access token belongs to the application that issued it. Reconnect afterwards.

Leaving the client secret field blank keeps the secret you already saved — it is never shown again
once stored, so a blank field means "keep it", not "clear it".

### Disconnecting

**Disconnect** forgets the connection here. It does not remove the authorization on Allegro's side
— your application stays listed under your Allegro account's connected applications until you remove
it there. If your intent is to cut access off entirely, do both.

## Listing profiles

A listing on Allegro carries a lot that has nothing to do with the stamp on it: which of your
**shipping rate sets** buyers pick from, how quickly you send, your return policy and implied
warranty, where the parcel is sent from, and whether you issue an invoice. All of it is the same for
a 1918 Polish issue and a modern block — it changes when you move house or add a courier, not when
you list something else.

So it is held once, as a named **listing profile** under Settings → Allegro, and every listing
published from here is published with one. Publishing (coming with the offer-publishing feature)
needs a profile; without one there is nothing to send Allegro as the delivery and returns half of a
listing.

### What is in one

- **Shipping rate set** — one of the delivery price lists defined in your Allegro account. This is
  not the same thing as the platform's **shipping methods** you pick from when recording a sale:
  that one records what the buyer actually paid, this one is Allegro's own table of what a listing
  offers.
- **Handling time** — how long after payment you send.
- **Listing duration** and **re-list automatically** — how long the offer runs and whether Allegro
  puts it back up when that runs out. Both are used only when the
  [Assistant](#listing-through-the-assistant) fills the sale form; publishing through the API takes
  Allegro's own default instead. The duration list holds only the lengths that both a quick buy and
  an auction offer, since one profile serves whichever the offer turns out to be — leave it on
  *leave as the form has it* to decide per listing.
- **Return policy** and **implied warranty** — from your Allegro account's own after-sales service
  conditions. Allegro fills these in by itself only for business accounts, so as a private seller you
  name them here. Either may be left unset if you have none defined.
- **City, post code and country** the parcel is sent from.
- **Invoice** — no invoice, a VAT invoice, or an invoice without VAT.

### Where the choices come from

The shipping rate sets and the two after-sales services are defined **in your Allegro account and
only there** — Stamporama reads them and lets you pick, and cannot create them. If a list is empty,
set it up on Allegro (Sales settings → Delivery price lists, and the after-sales conditions beside
it) and press **Refresh from Allegro** in the editor.

Nothing is remembered between openings: the lists are read from your account every time the editor
opens, so a rate set you added a minute ago is there. What is saved is *which one you picked*. That
choice is checked against Allegro when a listing is actually published — not when you save the
profile, so a profile can be edited while the connection happens to be down, and a rate set deleted
on Allegro is caught at the one moment it matters.

### The default, and per-offer overrides

One profile is the platform's **default**: what every listing goes out with. The first profile you
create becomes it automatically; **Make default** on any other moves it. An individual offer can
name a different profile — for a heavier package wanting a different rate set, or a run posted while
you are away from home — and an offer that names nothing simply uses the default.

Deleting a profile is never blocked. Offers that named it fall back to the default, and listings
already published are unaffected: Allegro holds their settings from the moment they went out, and
editing a profile here never changes a live listing. If you delete the *default*, the platform is
left without one until you set another — and publishing needs one.

## Learned categories

A listing also needs a **category** — and whatever parameters that category asks for. Unlike the
profile above, this is not a setting: it is about the stamp. A 1935 Polish used definitive belongs
somewhere quite different from a modern souvenir sheet, and the two categories ask different
questions.

Nothing is filled in up front, and there is no list to configure. **Publishing a listing is what
teaches it.** When a listing goes out and Allegro accepts it, Stamporama records two things:

1. What the stamp's **area, year, condition and subtype** were listed as.
2. What that category's **parameters** were answered with.

The second offer of the same kind then opens with its category and parameters already filled in.

### When nothing matches exactly

A near miss is matched by widening the question rather than by giving up. In order: the same area,
condition and subtype in **any year**; then in any **subtype**; then the same three questions one
level **up your area tree**, and so on to the top. The condition is never widened — used and mint
belong in different categories far more often than not.

If nothing is found at all, Allegro's own suggestion from the listing title is offered instead, and
failing that you pick from the category tree yourself.

Whatever the source, the suggestion always says what it was matched on — "Learned from Poland · 1935
· used, used 7 times", or "no exact match, so the year was widened" — and can always be changed
before anything is sent. Nothing is ever published on a guess you have not seen.

### A bundle of different things

An offer can hold copies that span years, conditions or areas. Each of the four facts is taken
separately, and only where the copies **agree**: a bundle of 1935 and 1938 Polish used definitives
still asks about its area, condition and subtype — it just does not ask about a year.

### Correcting one

Settings → Allegro → **Learned categories** lists everything the collection has learned, with how
often each association has been used and when it was last confirmed.

- **Change category** re-points a row at another category, chosen from Allegro's tree. Its count
  starts again from that one choice, since the new category has never actually been published into.
- **Forget** removes the row. The next offer of that kind asks again.

Remembered parameter answers are listed below, and can be forgotten one by one — the next listing in
that category then asks for the value again.

Listings already published are never affected by either: Allegro holds their category from the
moment they went out.

## The offer's Allegro card

An offer on your Allegro platform carries an **On Allegro** card on its own screen, next to the
photos and the sets. It holds the three things a listing needs that are not already on the offer:

- **Category.** Worked out by itself the moment the offer gains its first copy — first from what you
  have listed before, then from Allegro's own guess at the title — with a line saying which of those
  it was. Nothing waits for your approval: whatever it matched is what gets listed. **Change category
  or answers** opens Allegro's tree, and **↻ Match again** re-runs the match from scratch, which is
  the way back after a correction, or after the offer has changed enough that the first match no
  longer describes it. It never re-matches on its own — a category you corrected stays corrected.
- **Parameters.** What that category asks for, with the answers you gave last time already filled in.
  Required ones with no answer are marked. Some are marked *product*: those describe the stamp rather
  than the offer, Allegro takes them on its own sale form rather than through the API, and they are
  kept here for listing by hand.
- **Listing profile.** Which delivery, returns and sending address this listing goes out with —
  the platform's default unless you pick another for this one offer.

All three are read by whichever way you list: publishing through the API uses them, and so will
listing through the Assistant. They are set here, once, rather than in whichever dialog happens to
post.

Marking an offer **Ready** is what teaches Stamporama the category — not publishing it. That is
deliberate: you prepare a batch of offers and post them later, and the point of remembering is that
the *second* offer of a kind already knows the answer while you are still preparing. An offer left in
Preparing teaches nothing.

## Publishing an offer

> **Allegro's API only sells from a business account.** If you sell as a private person (a *Regular
> Account*), Allegro refuses to create a listing through the API — and there is no way to find that
> out except by trying, so Stamporama tries once, records what Allegro said, and shows it under
> **Settings → Allegro** instead of offering a button that fails. Everything else on this page keeps
> working: the sold worklist, recording sales and bid tracking are all reads, and they are unaffected.
> **The Assistant fills Allegro's own sale form for you instead** — see [Listing through the
> Assistant](#listing-through-the-assistant) below. The rest of this section applies to a business
> account, and to the sandbox.

Once the collection is connected and has a listing profile, a Ready offer on your Allegro platform
carries **🛒 Publish to Allegro** in its header, beside the other actions. It posts the listing
through Allegro's API — there is no form to fill and no link to paste back.

The dialog is a review rather than a form. Everything in it was decided somewhere you already own:

- the **title**, **price** and **quantity** come from the offer (the quantity is how many
  interchangeable sets it holds);
- the **photos** are the offer's upload set, in the order you put them in — the first one is the
  listing's thumbnail;
- the **category**, its **parameters** and the **listing profile** come from the offer's own
  **On Allegro** card (below).

Below that is the one real choice.

### Draft or live

**Draft** is the default. Allegro creates the listing in your account without showing it to buyers,
and the offer stays **Ready** here. It is the safe order of events: you can open the listing on
Allegro, look at it as a buyer would, and only then take it up.

**Live** publishes it at once. The offer becomes **Active**, today becomes its listing date, and the
listing's address is recorded on the offer.

### Activating a draft

An offer holding a draft shows **🛒 Activate on Allegro** in the same place. That takes the listing
live and marks the offer Active. Nothing else about the listing changes — it goes up exactly as it
was published.

### The offer number goes with it

Every listing published this way carries the offer's own number as its identifier on Allegro. That is
what lets **Sold on Allegro** below match an order back to the right offer exactly, instead of
working it out from the listing's address.

### If something is missing

The dialog lists every reason a listing cannot go out *before* it sends anything — one line per
reason, since each is fixed in a different place: a price on the offer's own header, a profile under
Settings, the images on the Photos card. It will not shorten an over-long title for you either:
Allegro takes 75 characters, and a title cut by the app is not the title you wrote.

### If Allegro takes its time

Allegro sometimes accepts a listing and validates it afterwards, and that validation can still refuse
it — most often for a duplicate. Stamporama waits for the answer:

- refused, and it says so in Allegro's own words, and the offer is left exactly as it was;
- still being checked when the wait runs out, and it says that instead. **Do not publish again** —
  the listing exists, and a second attempt would create a second one. Check the offer in your Allegro
  account.

### If Allegro refuses it

Allegro validates the listing and refuses it field by field, and Stamporama shows exactly what it
said — one line per complaint, each naming the field it is about (`location.postCode`,
`parameters[0]`, and so on). The generic *"Request contains invalid data"* on its own is never the
whole answer, and it is no longer all you get.

If you need to see what was actually sent — the whole request body and Allegro's raw reply — set
`STAMPORAMA_ALLEGRO_DEBUG=1` in the instance's `.env` and restart it. Every refused Allegro call is
then written to the app's log. It is off by default on a self-hosted install because a publish
request contains the entire listing; your access token is never logged either way. The local
development stack has it on already.

Your description is rewritten on the way out: Allegro accepts only paragraphs, two heading levels,
bulleted and numbered lists and bold, with no styling of any kind. Anything else — a link, italics,
a colour — is turned into its plain words. Nothing you typed is lost; only markup Allegro would have
rejected is.

### If Allegro says the account cannot sell through the API

You will see something like *"You cannot use the Public API method when selling with a Regular
Account (not registered as a Business Account)."* That is Allegro's rule about your account, not a
fault in the offer, and nothing you change here will get past it.

Stamporama remembers it, so it stops sending listings that are going to be refused. From then on it
is shown under **Settings → Allegro**, under the application's permissions, and every publish is
refused up front with the same sentence. It is checked again whenever you reconnect or change the
registered application — so if you do register a business account, or point the instance at a sandbox
application, connecting again is all that is needed.

### What it does not do

- It does not edit a listing already published. Allegro holds those values from the moment they went
  out.
- It does not end or withdraw a listing.
- It does not publish a batch. The bulk listing workspace is for the by-hand path.

## Listing through the Assistant

The other way to put an offer on Allegro is the [Assistant](assistant.md#filling-a-sale-form-for-you)
filling Allegro's **own sale form**, which works from any account — private included. A Ready offer
on your Allegro platform carries **⚡ List via Assistant** beside 🛒 Publish to Allegro, and the two
are alternatives rather than steps: the API is fewer clicks where Allegro allows it, and the form is
what you have if it does not.

It uses exactly what the **On Allegro** card shows — the same category, the same parameter answers
and the same listing profile the API path would have sent — so the two can never post the same offer
differently.

What happens when you press it:

1. Allegro's sale form opens in a new tab. If Allegro shows you its newer step-by-step form, the
   Assistant follows the *"dotychczasowy formularz"* link on it, gets past the product catalogue —
   your stamps are not in it, and nothing is ever filed against a catalogue product — and types the
   offer's **category number** into Allegro's own *Nr kategorii* field. That is what opens the form
   in the right category.
2. The form is **unfolded** where it needs to be: the rest of the category's parameters come out from
   behind *więcej parametrów*, the description editor is woken up (Allegro does not create it until
   something clicks into it), and an auction offer gets *licytacja* ticked, which is what grows the
   opening-price field.
3. Then it is filled: the title, every category parameter the offer has an answer for, the
   description, the price (or the starting price on an auction), the number of sets, and the delivery
   price list, handling time, listing duration, automatic re-listing and returns from the listing
   profile.
4. It stops there. You check it and press Allegro's own **wystaw** yourself, and the offer then goes
   **Ready → Active** with the listing's address recorded, exactly as it does on Colnect.

Two things it leaves to you, and says so in the report:

- **the sending address** — Allegro takes it from your account rather than from the form, so the
  Assistant states what the profile says it should read and you check the line the form already
  shows;
- **a parameter Allegro could not be asked about** — the answers are stored as Allegro's own value
  ids and the form wants their labels, so if Allegro is unreachable when the offer is handed over,
  that parameter is named rather than guessed at.

**When you post it, the offer goes live here by itself.** Allegro does not open the listing after
*wystaw* — it turns the form into *Oferta jest przygotowana*, with the offer's address as a link and
the same address still in the browser bar. The Assistant watches that page, takes the address from
it, and Stamporama moves the offer **Ready → Active** with the listing date and the URL recorded. The
offer is still awaiting Allegro's own review at that point, which is Allegro's normal course: the
listing exists and that is where it will be.

**The "AI" watermark question is answered for you, with nothing ticked.** Allegro asks, as the
pictures go in, which of them should be marked as generated or altered by AI. Your offer's pictures
are photographs of your stamps, so the honest answer is none — the Assistant confirms Allegro's own
default and never ticks a box on your behalf. The report says so.

**Opening the form creates a draft on Allegro.** That is Allegro's own doing — its form is
draft-backed from the moment a category is chosen, exactly as when you open it by hand — so a listing
you start and abandon leaves one behind. They are listed under *Kontynuuj wystawianie* the next time
the form opens, with **Usuń** beside each.

It refuses the same things the API path refuses — no category, no listing profile, no price, no
pictures, an over-long title — because those are facts about the listing rather than about the API.
What it does not need is the connection: nothing about ⚡ asks Allegro for permission to sell.

## Sold on Allegro

Once connected, **Offers → Sold on Allegro** shows what has sold and is still waiting to be written
down. It is a worklist, not a search: rows leave it as you record the sales, and it fills itself
again in the background.

Stamporama checks for **new orders and new bids every two minutes**, and reads your whole account
every 15 minutes — the second is what notices a listing that has quietly ended, since that can only
be told from a complete read. **Sync now** runs the full check immediately.

### From the listing page instead

The worklist is the sweep. When you are already looking at your listings on Allegro, the
[Assistant](assistant.md#your-own-listings-on-allegro) names the offer each one is here — a card in
the corner of a listing page, a small link per row in **Mój asortyment** — and one click opens it.
Connecting the API makes that recognition exact: it uses the same matching this sync does.

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

The same fact reaches the screens you actually work from, so an order does not have to be gone
looking for here: an offer whose listing is on one of these cards carries a **Sold on Allegro · not
paid** chip on the offers list, is counted by its **Sold, not recorded** filter, and is reported by
the notification bell — while every *other* listing holding those copies is flagged **Needs action**,
since the stock is committed the moment the order exists (see [sold on a
platform](offers.md#sold-on-a-platform-not-recorded-here)). All of it is this list, read from
elsewhere: a row leaves both the moment the sale is recorded.

Four chips narrow the list: **Paid** / **Not paid**, and **Matched** / **Unmatched**. They are two
separate questions, so you can combine them — *Paid* + *Unmatched* is the pile most worth clearing
first. Leaving an axis untouched means it is not asking. The numbers on the chips always count the
whole list, not what the other chips have left, so they tell you what is there to filter to.

### Recording the sale from the order

**Record sale from order** turns the whole order into one sale, filled in from what Allegro says
about it. It is the fast path, and it is the reason the connection is worth having: an order carries
things a listing page never showed you.

It opens on a **review**, before anything is written, saying exactly what it is about to record:

- **the buyer**, filed under their **Allegro login** — which is how buyers are named here, and how
  the ones already in your address book are named. The name on the order is not thrown away: it goes
  to the contact's **Full name**, which is what the parcel has to carry. An existing contact is
  looked for both ways, under the login and under the full name, so a buyer you wrote down by hand
  years ago is still recognised rather than duplicated. Where there is none, the sale form offers to
  add one — which happens when *you* save, and not before. The full name and the email are filled in
  on the contact only where it has neither: Stamporama never overwrites something you typed with
  something a marketplace said.
- **what they paid in total**, delivery included, as the sale's *Total paid by buyer* — so your
  handling is derived from it rather than typed twice.
- **the delivery method** the buyer chose, matched by name against this platform's own shipping
  methods. Matched, it brings that method's usual cost with it; unmatched, it is recorded as a
  one-off carrying Allegro's wording, with no cost filled in. What the buyer paid for delivery is
  *not* put in your shipping cost — that column is what posting the parcel costs you, and the
  buyer's postage is already inside the total above.
- **the order number and a link to the order**, as the sale's transaction reference and link.
- **every line**, and the sets each one will record as sold — by name, because these are the copies
  that leave your collection.

A line the app is **not sure about** is named and left out rather than guessed at. It says which and
why: no offer here, nothing left to sell on that offer, already on the sale, or *needs you* — which
means the quantity bought does not say which of the offer's remaining sets went. A wrong composition
is worse than none, so those are yours to record from the offer's own screen, which is what the
per-line **Record sale** button beside them is for.

From the review, **Review sale details** opens the ordinary sale form, pre-filled. Nothing at all is
written until you save it there. If Allegro says the order is paid, the sale is recorded at *paid*
rather than *ordered*.

If Allegro cannot be reached at that moment the review still opens — the delivery method and the
email are simply missing, and it says so. A pre-fill is a head start, never a precondition.

A card disappears once a sale exists carrying that order number as its transaction reference, and
that sale covers every line of the order. That is also why one order can never turn into two sales.

**Orders Allegro merges are shown once.** A buyer who wins several auctions gets a separate order for
each one until they pay; paying for several at once makes Allegro combine them into a single new
order and abandon the originals — unpaid, and never updated again. Stamporama recognises them by the
purchases they carry and shows only the combined order, so the same sale is never asked for twice.
The originals disappear from this list at the next sync, within a couple of minutes of the payment.

**A partly recorded order stays here**, marked *Partly on sale #12*. That happens when only some of
its lines could be recorded — the second offer was never matched, say. The lines already done are
marked *Recorded* and the button becomes **Record the rest**, which adds the remaining sets to that
same sale. Nothing else about it is touched: its buyer, amounts and existing lines are your record,
not the sync's.

The per-line **Record sale** stays where it was, opening the same sell flow the offer's own screen
uses. It is the way to record what the order flow will not guess at.

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

The same check also carries the auction's **closing time** onto the offer, whether or not anyone has
bid — it is a fact about the listing rather than about the bidding. That is what fills in **Closes**
on the offer's header, and it is kept current rather than filled in once: when Allegro **relists an
unsold auction by itself**, the next check brings the new closing time with it, so the listing never
sits there looking like an auction that ended and was ignored (see [ended
auctions](offers.md#ended-auctions--waiting-on-you)).

It does this without asking. A bid commits you whether or not you have seen it, and a marker waiting
for your confirmation would be no faster than clicking it yourself. So that you always know it
happened, the auction appears in the notification bell under **Bidding started on Allegro** — once,
as a notice: it stays there until you have seen it, and opening the offer is what marks it seen.
Auctions that are simply running with bids on them do not pile up in the bell; the offers list's
**In bidding** filter is where you see all of those. The offer's own header always says what Allegro
reported and when.

Three things it will not do:

- **It never clears the marker.** Not when the auction ends unsold, not when a bid is cancelled, not
  when the listing is withdrawn. You pulled stock on the strength of that flag, so un-committing is
  yours to do: **Clear active bidding** from the offer's **⋮** menu. A cancelled bid is not left for
  you to spot, though: the offer says *"no bidders"* beside a marker that is still on, and the
  notification bell raises **Bid withdrawn, still marked in bidding**, which stays until you settle
  it.
- **It never copies the opening price into the bid.** An auction nobody has bid on keeps **No bids
  yet**; what it opened at is the starting price, which is yours.
- **It leaves quick-buy listings alone**, and any auction whose listing is quoted in a different
  currency than the offer keeps its typed figure — the marker still goes on, but Stamporama will not
  convert a price for you.

The worklist header says when bids were last checked, and says so plainly if that check is failing.

### What it does not do

- It never creates a sale, and never touches money.
- It never edits your offers, beyond the bid marker, the standing bid and the closing time described
  above.
- It never creates a contact. The buyer's login is shown, not saved as somebody to write to.
- **Cancelled orders are left out entirely.** The sale did not happen, so there is nothing waiting.

## The sandbox

Allegro runs a sandbox that mirrors the real thing. A sandbox application is registered separately
and has its own client ID and secret, so switching the toggle means pasting the other pair in. It is
worth using while you are trying things out — nothing about orders or sales should first be
exercised against a live selling account.
