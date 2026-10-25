# Connecting an AI assistant

Stamporama can be handed to an AI assistant — Claude, or anything else that speaks **MCP** — so that
you can ask it about your collection in ordinary words. *"What have I got from the 1928 set that is
not in an album yet?"* *"Which of my Michel numbers are missing a price?"*

It connects to **one collection**, through a token you make yourself, and you decide whether that
token may change anything or only look.

This is not the [Stamporama Assistant](assistant.md), which is a Chrome extension for marketplace
pages. They are different things that happen to use the same kind of token, and the same screen
makes both.

## What you need

- Your instance reachable from wherever the assistant runs. If you run Stamporama on your own
  machine and the assistant runs there too, that is `http://localhost:3000`. If the assistant runs
  somewhere else — a phone, a hosted client — the instance has to be reachable from there.
- A **token**, made in **Settings → Assistant & API**.

## Making the token

1. Open the collection you want the assistant to see.
2. Go to **Settings → Assistant & API** and choose **Generate token** at the top right of the page. Its
   fields open beside the token list.
3. Pick **Agent** for what it is for. That is only a label, so you can tell this row of the list from
   the extension's; it does not change what the token may do.
4. Pick what it **may do**:
   - **Read only** — it can look at this collection and nothing else. Anything that would change
     something is refused, and the assistant is told which kind of token would have been needed.
   - **Read and write** — it can change things too.

   **Start with read only.** You can always make a second token later, and an assistant that can only
   look is one you can leave running without thinking about it.
5. Copy the token. **It is shown only once.** If you lose it, revoke that row and make another.

You can revoke a token at any moment from the same screen, and whatever was using it stops working
immediately.

## Pointing a client at it

The address is your instance followed by `/api/mcp`, and the token goes in an `Authorization`
header:

```
https://stamporama.example.com/api/mcp
Authorization: Bearer stmpa_…
```

Most clients are configured with a small block of JSON. For a client that speaks to a remote MCP
server over HTTP, it looks like this:

```json
{
  "mcpServers": {
    "stamporama": {
      "url": "https://stamporama.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer stmpa_your_token_here"
      }
    }
  }
}
```

Where a client insists on launching a local command rather than talking to a URL, point it at any
of the usual HTTP bridges for MCP and give the bridge the same URL and header.

Stamporama speaks MCP revision **2026-07-28**, and also answers to `2025-06-18`, `2025-03-26` and
`2024-11-05`, so a client that connected before keeps connecting. A client newer than that is told so
in as many words rather than failing quietly, so if yours reports an unsupported protocol version,
that is what it means — the instance needs updating.

**The collection is not in the address, and that is deliberate.** The token already says which
collection it is for, so there is nothing to get wrong and nothing an assistant could point at the
wrong one. Two tokens for two collections are simply two entries.

## Checking that it worked

Ask the assistant to **list its tools**. You should see Stamporama's, each with a sentence saying
what it does. If the client shows nothing, it is nearly always one of three things:

- **The address.** It ends in `/api/mcp`, with no trailing slash and no collection in it.
- **The token.** A wrong or revoked one comes back as *unauthorized* with a sentence naming the
  screen that makes a new one. Tokens are shown once, so a half-copied one is the usual cause.
- **Reachability.** If the assistant runs somewhere other than your own machine, `localhost` means
  *its* machine and not yours.

Then ask it something small — *"what conditions are set up in this collection?"* — which is the one
call every assistant makes first anyway. Each condition comes back with its name, its abbreviation
and, where you set one, its catalogue symbol (`**`).

## What it can do, and what it will not

The tools grow with each release, and the assistant reads the current list itself, so what it can do
is whatever your instance offers rather than whatever was written here.

**It can read a catalog number the way a dealer writes one.** Listings and price lists write numbers
in their own way — `Mi 123a`, `Michel 123`, `Fi 456`, or just `123a` with the catalogue taken for
granted — and the assistant can hand a whole batch of them over at once and get back, for each, the
stamp in your collection it means. What matters is that it is told **how sure** each one is: exactly
this stamp, several it cannot choose between, a number written in a catalogue you do not keep, or a
number you simply do not have. Those last two are different news — the first means *tell me which of
your catalogues to read it as*, the second means *you have not got it* — and it will say which.

**It will not pick between candidates**, and that is deliberate rather than a limitation. If `123a`
is a number in two of your catalogues, it comes back with both and says so. Nor does it guess across
catalogues: a number written as Fischer's is never quietly answered with the Michel stamp of the same
number. And your area prefixes count — `Mi·SP 1` and `Mi·PL 1` stay two different stamps, as they do
everywhere else in the app. A **read only** token can do all of this.

**It knows your stamps' own numbers.** Every stamp it tells you about comes with the number the
app shows on the stamp's row (`#901`), and wherever it has to name a stamp you can give it that
number as `st 901` — the same thing you would type in **Jump to…** — instead of a catalog number.
The `st` is needed: a bare `901` is read as a catalog number, because that is what it usually is.

**A read-and-write token can change things, and there are eleven places where that is now true.**

On **listings**, it can start one around copies you are not offering yet, set what you are asking
for it, and write or re-generate its title and description — all of it inside Stamporama, on a
listing that is still a **draft**. Nothing it does goes anywhere near a marketplace, and it cannot
mark a listing ready or make it live: those are still your two clicks on the offer's own screen.

On **exchanges**, it can start a trade with somebody you already have in Contacts, say what you
would send and what you would like back, take a line off, and tell you whether the two sides
balance. It works out which of your copies would answer *"the Kościuszko, mint"* using the same
order the app uses — one you have marked for trade first, then a plain single, then one with a
picture — and it tells you plainly when you hold nothing that fits, which is the half you send back
to your partner. It can also tell you which of somebody's stamps are on your want list, and what a
series' checklists are still missing.

**What it cannot do on an exchange is anything your partner would see.** It does not share the
list, make the link, agree the trade, answer what they wrote on it, or close it. A trade it builds
sits on your trades screen as a draft until you look at it.

On **purchases**, it can enter an order you paste or forward to it — an order confirmation, an
auction invoice, a seller's email — so you do not retype it. It can:

- **find a purchase** by seller, by date or by its number (*p12*), and read one with its lots,
  expenses and what it all cost — in the currency you paid and in your base currency, exactly as the
  purchase screen shows it. When no exchange rate is recorded for a foreign purchase it says so
  rather than giving you a zero. A **read only** token can do this much;
- **enter a purchase**: the seller, the marketplace it came through, the date, the currency and the
  shipping — and **correct** any of those later;
- **add lots**, give them a title and a price, rename or reprice one while it is open, and **remove
  a lot that is still empty**;
- **add, change and remove expenses** — the things bought with the stamps that are not stock, like a
  magnifier or a catalogue;
- **add packing supplies bought on the order** — a box of 100 envelopes at its price — which become a
  batch of that supply's stock, as on the purchase screen. It cannot change or remove a supply line
  once added; that stays on the purchase screen;
- **add the seller to your Contacts** when you have never bought from them. It always looks for them
  first, by the name they are filed under or their full name, and uses the contact you already have.
  If the name is close to somebody you already know — *Kowalsky* when you have a *Kowalski* — it is
  told so and must say it really is a different person before a new contact is made. A new contact
  gets a name and, for a marketplace seller, their login — and, for an auction house, that it is one
  and the country it sells in — and nothing else.

**What it cannot do on a purchase is anything about the stamps themselves, or anything you cannot
take back.** It never adds, moves or removes a copy — the purchase arrives with empty lots, and you
identify the stamps into them as you always do. It does not close or reopen a lot,
mark an order in transit or arrived, or delete a purchase, and it will not remove a lot that already
holds copies or has closed. It does not touch the order a closed trade created, and it never sees or
changes a contact's email, phone, address or notes, nor edits or deletes a contact you already have.
Everything it writes is on the purchase's own screen, where you can change it back.

On **sales**, it can record what sold — say, after going through your offers on Facebook and
finding which went and to whom. It can:

- **find a sale** by marketplace, buyer, status, date or its number (*s12*), or only the ones still
  waiting for your review, and read one with its sold sets, their prices and what the sale brought
  in. A **read only** token can do this much, and it is how the assistant checks a sale is not
  already recorded before recording it again;
- **find the buyer, or add them to your Contacts.** On Facebook it goes by the buyer's profile link
  first and their name second, exactly as **Sell** does, and it keeps the link on the contact. A name
  you already have under a different profile is refused as somebody else, and a name close to
  somebody you know must be confirmed as a different person before a new contact is made;
- **sell an offer** — every set it still has — **or one set of it**, at the price the assistant
  read (the winning bid, the price paid), into the buyer's sale you already have open or a new one on
  the day it sold. It is refused wherever **Sell** would refuse, and it never adds to a sale that has
  already been sent.

Every sale it records or adds to is marked [*To review · API*](sales.md#what-the-assistant-recorded--to-review--api)
until you confirm it. **It cannot delete a sale or move one along** — no *Paid*, *Packed* or *Sent*,
no packing, shipping, prices or buyer changed afterwards; that stays on the sale's own screen. It
does not record a running auction's current bid either: the price it sells at is the one it read.

On the **conversations with your buyers**, it can keep the
[log](sales.md#the-conversation-with-the-buyer) that a sale's screen and a contact's page show —
reading a Messenger thread, an e-mail or the marketplace's messages and writing down what was agreed.
It can:

- **read and search the log** — a buyer's whole conversation, the entries about one sale, or entries
  found by words, channel and dates. A **read only** token can do this much, and it is how the
  assistant checks a conversation is not already recorded;
- **record a conversation**, several entries in one go, each with when it was said, the channel, the
  direction, a summary, and optionally a quote, a link and which of the buyer's sales it is about.
  It names the buyer by their name or Facebook profile, as **Sell** finds one, and a sale by its
  number (*s12*); a sale of somebody else is refused. It never creates a contact here — finding or
  adding the buyer is its own step;
- **correct** an entry, **move** it to another sale of the same buyer or to none, and **delete** one;
- **attach files** to an entry — pictures and PDFs, such as a payment confirmation or a scan of a
  certificate — when it records the conversation or afterwards, and **remove** one. It reads an
  entry's files as links and fetches one only when it needs what is in it; a **read only** token can
  list and fetch them, but not attach or remove.

Every entry it writes is marked *Assistant*. Nothing waits for your review: an entry changes no sale,
status or amount.

On **shipping and packing**, it can set up the data you would otherwise type in yourself under
[Settings → Carriers](collections.md#carriers), on a platform's shipping options and under
[Settings → Packing supplies](collections.md#packing-supplies). It can:

- **read your carriers and their rate lists** — each service, what sending by it costs you, and the
  packing supplies a parcel sent that way usually takes — **each platform's shipping options** with
  what the buyer pays and the service each is sent by, and **your packing supplies** with what is on
  hand, what it is worth and the batches it came in, and each supply's history: the sales that packed
  with it and what you used outside sales. A **read only** token can do this much;
- **add a carrier and correct one** — its name and the address its parcels are tracked at, with
  `{code}` where the tracking number goes, exactly as Settings asks for it;
- **add a service to a carrier's rate list and correct one** — its name, its cost, its currency and
  its usual packing supplies, each with how many a parcel takes;
- **add a shipping option to a platform and correct one** — its name, what the buyer pays, its
  currency and the carrier service it is sent by, or none;
- **add a packing supply and rename one**;
- **record supplies you took out of stock outside a sale** — transport cards kept for storage — and
  **correct** such a use. As on the [Packing supplies screen](purchases.md#using-supplies-outside-sales),
  it cannot take more than you have on hand.

The rules are the screens'. A name already used — a carrier or a supply in your collection, a
service on its carrier, an option on its platform — is refused, and the assistant is told which one
has it. Changing a rate or a buyer price never changes a sale you already recorded.

**It cannot delete anything here** — no carrier, service, shipping option, packing supply or use —
and it never touches a sale's own packing supplies. Those stay on their screens.

On **what a copy is**, it can say which stamp one of your copies is — or, when that cannot be told
from the piece, which stamps it **might** be: *Mi 123aI or 123bI* when the type is clear and the
colour is not, or *Mi 85 or Mi 101* when the watermark that decides between two issues cannot be read
on a cover. Such a copy is valued and offered at its cheapest possibility, and is marked as having its
variant still to settle; the assistant can list those copies for you, narrow one down, or settle it
to the stamp it turned out to be. Whenever it tells you about such a copy it names it the way the app
does — *123aI or 123bI* — and never as one of them. It only ever changes a copy you already have; it
does not create one.

On **stamp sizes** — the figures your album pages cut hawid strips to — it can put a size it reads
in a catalogue or a dealer's list onto your stamps, so you do not type it stamp by stamp. It can:

- **read your size presets**, and **read a stamp's size with where it comes from**: stated on the
  stamp itself, or borrowed from its nearest neighbour on the same checklist, the way an album page
  borrows one — naming the stamp it is borrowed from. A **read only** token can do this much;
- **save a new preset and correct one** — its width, its height or its name — under the same rules
  as Settings. As there, correcting a preset does not change the stamps already sized from it;
- **set one stamp's size**;
- **apply a preset, or a width and height, to a series** — a whole issue, one checklist, or a list of
  stamps — including the variants under them, exactly as the *Apply size* dialog does. It first asks
  what the apply would do and can tell you in the dialog's own words — *17 stamps have no size and
  will get 25 × 30 mm; 3 already state one* — and a **read only** token can ask that too.

**It never replaces a size a stamp already states unless it is told to**, and the same goes for a
stamp that states only a width or only a height. A stated size may be one you measured, and the
assistant cannot measure anything; if one is wrong, say so and it will overwrite it. A size it writes
is an ordinary size on the stamp, like one you typed. It names stamps by their catalogue numbers, and
a number that fits more than one of your stamps is refused with the candidates rather than guessed.
It **cannot delete a preset** or change their order — that stays in Settings.

On **issues and stamps** — the catalogue itself — it can enter a series it reads on a catalogue
page, a dealer's list or Colnect, so that you do not type in what it could have. It can:

- **list the issues of an area** — what you already have catalogued there, whether you hold any of it
  or not — in the order the *Issues* list shows them, with or without the areas under it, narrowed to
  some years and to a name or a catalogue number as the list's search box narrows it. Each issue
  comes with its year, its name in your languages, its area, the range it declares in each
  catalogue, any prefix of its own, how many stamps it has, and how many copies you hold of them in
  each condition. It can narrow the list to the issues with numbers in one catalogue, read up to 200
  issues at a time, and ask for **every stamp's catalogue numbers** with each issue — the variants
  too, marked as variants, and the stamps whose numbers fall outside the range the issue declares —
  so it sees which numbers are already taken before it adds any. So an assistant entering
  *Generalgouvernement 1940* can see first which of its series are already there. A **read only**
  token can do this;
- **create an issue** in one of your areas, with its year, its name and each catalogue's numbers,
  written the way the *Add issue* form takes them — `Mi: 100-105, 107`, or `2895A-2897A,
  2895B-2897B`. The numbers declare the issue's range and create its stamps, one per number, matched
  across catalogues by position and put on the issue's checklist, as the form's *Assign to stamps*
  boxes do. It can give the new stamps a size preset while it is at it, and give the issue a prefix of
  its own in a catalogue — the *Prefix* field beside each catalogue on the form — when a catalogue
  files the series under another prefix than the rest of the area;
- **add stamps to an issue**, one per number, at the end of the issue's order and on its checklist,
  as the *Add stamp range* dialog does;
- **add a run of variants under a stamp** — `a-f` under `240` makes `240a` to `240f` — with the kind
  of variant they are, exactly as the *Add variant range* dialog does. Where they are a stamp's
  first variants and it has catalogue prices of its own, the dialog would ask whether to keep
  them ([see why](variant-prices.md#when-a-priced-stamp-gets-its-first-variant)); the assistant is
  not asked — the prices stay, its answer says so, and it can clear them if you tell it to;
- **correct an issue**: its name, its year, its name in your other languages, the range it
  declares in a catalogue, and its own prefix in a catalogue — set, changed, or taken off so the issue
  follows its area's prefix again. It cannot make an issue show *no* prefix where its area has one,
  because the issue form cannot either; that is said on the area;
- **correct a stamp or a variant**: its name and translated names, its date of issue, its number in
  any catalogue its area keeps, and its attributes — denomination and perforation as printed, and the
  colour, watermark, paper and printing from your own lists in Settings;
- **correct the kind of a variant** — its [subtype](collections.md#stamp-subtypes): set it, change
  it, or clear it, which gives the variant your default subtype, exactly as the stamp form's
  *Subtype* field does. A subtype you do not have is refused, and the assistant is told the ones you
  do. Only a variant has a subtype, as on the form. Where the new kind makes it a stamp's first
  variant and that stamp has catalogue prices of its own, the prices stay and the assistant is told,
  as when it adds variants;
- **add a subtype and correct a subtype's name**, as *Settings → Stamp subtypes* does — so an
  assistant entering a specialised catalogue can name a kind of variant you have no subtype for yet,
  and use it straight away. A new subtype goes at the end of your list and is never the default; it
  acts as a variant unless the assistant says it is an entry of its own, such as a plate flaw. A name
  you already have, in any mix of capitals, is refused. Deleting a subtype, reordering them, choosing
  the default and changing whether one acts as a variant stay in Settings.

Only what it is told to change changes; a stamp's other catalogue numbers and fields stay as they
are. A name in another language is accepted only in a language you list or print in.

**It never creates a stamp you already have.** A catalogue number that is already in your collection
— the same catalogue and the same prefix, so `Mi·SP 1` and `Mi·PL 1` still count as two — is refused,
and the assistant is told which stamp has it. That holds even when your **Duplicates** setting only
warns: that setting is for you, typing a duplicate on purpose, and the assistant can always look the
number up first. The same goes for an issue's prefix: one that would make a stamp of that issue read
as a number another stamp already has is refused, naming both, and nothing is changed. It will not
create an issue in a grouping-only area, nor record a number in a catalogue the area does not keep.

**It can correct the variant tree**, the way *Move under another stamp…* and *Delete* do on your
screens:

- **Move a stamp under another stamp of the same issue**, so it becomes that stamp's variant — a
  variant hung under the wrong stamp, or a stamp that turns out to be a variant of another. Its own
  variants come with it, and its catalogue numbers, prices, size, copies and checklist places stay as
  they are. A stamp from another issue, or one of the stamp's own variants, is refused.
- **Bring a variant up** to stand on its own at the top of its issue.
- **Delete a variant created by mistake**, but only when nothing names it. A variant with copies,
  offers, wants, auction lot lines, price observations, trade lines or variants of its own is refused,
  and the assistant is told which — so it never takes a record of yours with it. Its catalogue
  numbers, catalogue prices, translations, checklist places and photos go with it, and the assistant
  is told how many. This is stricter than your own *Delete*, which takes a variant's copies and wants
  with it.

If a stamp that becomes a variant's parent had catalogue prices of its own, they are kept and the
assistant is told so, exactly as when it adds variants.

**It can move a stamp to another issue, and delete what was created by mistake**, the way *Move to
another issue…* and *Delete* do on your screens:

- **Move a stamp, with its variants, to another issue of the same area** — a stamp filed under the
  wrong issue, or one your catalogue prints as a series of its own. It goes at the end of the other
  issue's stamps, or at the place the assistant names. It leaves the old issue's checklists and joins
  the new issue's own checklist, which is started for it if the issue has none; a variant joins it too
  only if it was on such a checklist before. Its catalogue numbers, prices, copies, Colnect ID, size
  and photos stay as they are. Where the new issue has a prefix of its own and the stamp's number
  would then read as one another stamp already has, the move is refused, naming both. The assistant
  can also have both issues' catalogue ranges worked out again from their stamps. An issue in another
  area is refused, as on your screen, and so is a variant on its own: it moves with its base stamp.
  Unlike your own *Move to another issue…*, the checklists follow the stamp.
- **Delete a base stamp created by mistake**, but only when nothing names it — the same list as for a
  variant, its own variants included. It is taken off its checklists, and the assistant is told which.
- **Delete an empty issue** — one created without stamps and never filled, or one whose stamps have
  all been moved away — with its empty checklists. An issue that still has a stamp is refused, saying
  how many, and so is one whose checklist an album prints, naming the album.

**What it cannot do on the catalogue is delete or move anything else.** It never deletes an issue that
has stamps or a stamp anything names, never takes a catalogue number off a stamp, never takes a stamp
out of an issue without moving it to another, never merges two issues, and never changes the order of
an issue's stamps beyond placing one it moves. Those stay on the issue's and the stamp's own screens,
where everything it creates can be seen and corrected. Checklists, clearing a
catalogue price and areas are the other exceptions, below — moving an issue to another area among
them.

**It can also record a stamp's Colnect item-ID** — the number in the stamp's Colnect address, which
listing on Colnect, the Colnect links and the Colnect list sync all go by. An assistant reading a
Colnect page or a Colnect export can put it on the stamp, change it, or take it off, and it takes
the address as readily as the bare number. It is recorded exactly as the item-ID box on the stamp
does it, so the listing and the links use it straight away. Two things hold:

- **One item-ID belongs to one stamp.** An ID another of your stamps already has is refused, and the
  assistant is told which stamp that is. If the ID sits on the wrong stamp, it has to be taken off
  there first — the assistant never moves it on its own.
- **A change or a removal names the ID it replaced**, so you can see what was there and put it back
  on the stamp's screen.

On a stamp with variants the item-ID is about that stamp itself. Listing a copy you have not
identified down to the variant under its cheapest variant is worked out when you list it, and is
never written onto the parent stamp.

On **catalogue prices** — the figures per edition, condition, certificate and format that most of
your typing goes into — it can enter a catalogue page for you, a whole set at a time. It does
exactly what the [variant price grid](variant-prices.md) does, cell by cell. It can:

- **list your catalogue editions** — each book and year, with the currency its prices are in — or
  just the editions an area's grid offers. A **read only** token can do this;
- **read the prices of an issue or of a stamp's whole tree**, every edition, condition, certificate
  and format at once or narrowed to some of them. A stamp with variants shows the lowest of its
  variants' prices, marked as worked out rather than recorded, just as the grid's locked row shows
  it with `≈`; a price you recorded on it shows as recorded. A figure the grid shows greyed on a
  format tab — the single's price times the format's multiplier — is marked the same way. A **read
  only** token can do this too;
- **record prices** in one edition, many cells in one go: a stamp, a condition, the price, and a
  certificate and a format where the price is not for a plain single. They are stored as if you had
  typed them into the grid — rounded to cents, in the edition's currency — and valuation uses them
  straight away. A price on a stamp with variants is that stamp's own, as unlocking the grid's row
  and typing one is. Where the catalogue prints **—** or **?** instead of a price, it records that
  too, as typing `-` or `?` into the grid does — and reads such cells back as *does not exist* or *not
  determinable* rather than as missing prices;
- **clear prices**, as emptying a grid cell does. The cell then records nothing, which is not the
  same as a price of nought — and not the same as **—** or **?** either;
- **find the prices still missing** across an area (with every area under it), an issue, a checklist
  or a list of stamps — whether you have the stamps or not. By default it looks in each stamp's
  area's main catalogue, newest edition, at every condition, without a certificate, as a single; it
  can be asked about another edition, some conditions, certificates or formats instead. The answer
  is grouped by issue in catalogue order, each stamp with its numbers and the cells it lacks, so a
  whole series can be priced in one go afterwards. A cell with **—** or **?** is not missing. Neither
  is a format cell the grid already works out from the single's price, nor a stamp with variants
  whose variants all have the price. A certificate cell the grid's *Fill from None* could fill is
  still missing, and the answer says what the fill would write. A **read only** token can do this.

**Each cell is answered on its own**: written, unchanged because that figure was already there,
cleared, or refused with the reason — a stamp number it cannot place, a condition you do not have, an
amount that is not one. One wrong cell never stops the rest of the page, and a changed or cleared
price names the figure it replaced. **It works nothing out on its own**: it does not apply a format's
multiplier or a certificate's percentage when it writes, as the grid's fill buttons do — a figure it
wants recorded, it sends as a price. Clearing a price is the only thing it removes from the
catalogue: it never deletes a catalogue, a book or an edition.

On **checklists** — the sets of stamps you count as one complete unit — it can build and tidy them
for you: *a checklist of the watermark Y stamps of this issue*, *a checklist of all Grosik
1928–1932*, *take the reprints out of this one*. It can:

- **list your checklists**, each with the issue it belongs to — or, for one spanning issues, every
  issue its stamps come from — how many stamps it holds and which albums print it, and **read a
  checklist's stamps in their order**. A **read only** token can do this much;
- **create a checklist** on an issue, or one spanning issues like the ones on the *Checklists* screen,
  and give it its [type](collections.md#standard-and-specialised-checklists) — a checklist of one
  stamp's colour variants is made *specialised*, an everyday set *standard*;
- **rename one**, set or take off its name in your other languages, and change its type;
- **add stamps** to it, at the end of its order. An issue's own checklist takes only that issue's
  stamps, as its editor on the issue offers only those; a stamp of another issue is refused, and
  belongs on a checklist spanning issues;
- **take stamps off** it. The stamps themselves stay in your catalogue and in their issue — only the
  set stops counting them;
- **set the order** its stamps read in, the one an album page prints them in: the stamps it names
  come first, in the order named, and any it leaves out follow them as they were;
- **delete a checklist no album prints.** One that an album prints is refused, and the assistant is
  told which albums — take it out of them first, or delete it yourself on the screen, where the
  confirmation says what it takes with it.

Taking a stamp off or setting the order is safe to repeat: a stamp that is not on the checklist, or a
number it cannot place, is reported and the rest is still done. A checklist printed in an album
changes just as it would from the screen — the printed card reports the difference, and nothing is
reprinted. It **cannot change the order of an issue's checklists** among themselves; that stays on
the issue.

The assistant sees checklists the way the app shows them by default: **only standard ones are listed
and counted** — in its list of checklists, an issue's and a stamp's checklists, the gaps it finds,
the sizes a stamp borrows and the names missing a translation — unless it asks to include the
specialised ones, which it does when you ask about them. Every checklist it reads states its type,
and one it names directly is answered whatever its type.

On **areas** — the countries, periods and territories your issues are filed under — it can set up a
new collecting field from a catalogue's table of contents, and reorganise the tree. It can:

- **read the area tree**, in the order the *Areas* screen shows it, each area with its parent, how
  many issues and stamps are filed directly under it, the catalogue settings it makes itself, and the
  ones its issues actually get once everything inherited from the areas above is taken into account.
  A **read only** token can do this much;
- **create an area** under another, or at the top level, with everything the *Add area* form has:
  its name, the title name listings use (the name itself, unless it is told otherwise) and that name
  in your other languages, its [symbol](collections.md#area-symbol), a description, whether it is grouping-only, and its catalogues — the
  catalogues its stamps are numbered in, the prefix for each, which one leads, the catalogue volumes
  that price it and which of them gives a copy its catalogue value. Whatever it leaves out is
  inherited from the areas above;
- **correct an area** the same way — only what it is told to change changes, and renaming keeps the
  title name in step while the two are the same, as the form does;
- **move an area** under another parent, or to the top level, with its sub-areas and their issues,
  as the *Parent area* field on the form does. It goes to the end of its new siblings;
- **put areas in order** among their siblings, as dragging them on the *Areas* screen does;
- **move an issue to another area**, as *Move to area* on the *Issues* list does.

The *Areas* screen's rules hold unchanged. An area cannot go under itself or under one of its own
sub-areas; an area with issues or stamps filed under it cannot become grouping-only; an area that
holds issues needs a catalogue volume giving its copies their value, set on it or above it; and an
issue cannot be filed under a grouping-only area. Each is refused, and the assistant is told why.

**A move says what it changed.** Moving an area or an issue changes what its issues inherit — the
prefix a stamp's number carries, which catalogue leads, which volume values a copy — so the
assistant is told, for every area whose issues now read differently, what they resolved to before
and after, and, for an issue, any catalogue its stamps are numbered in that the new area does not
keep. A prefix you set on an issue itself goes with the issue.

**It cannot delete an area.** That stays on the *Areas* screen.

On **translations**, it can translate your texts into the languages you list or print in — the names of your areas,
issues, checklists and stamps, and the names and abbreviations of your conditions, certificates,
formats, subtypes, colours, watermarks, papers and printing methods. Filling hundreds of them is what
an assistant is good at, and until one is filled a listing title or an album page in that language
prints the text in your collection's own language. It can:

- **list what a language is missing** — each text with its words in your own language and what it
  belongs to, such as a stamp's catalogue numbers and issue — for the whole collection, for one kind
  of text, for one area and every area under it, or for one album. For an album the list is exactly
  what its pages not yet printed would print untranslated, the texts the page editor flags. A **read
  only** token can ask this;
- **write the translations**, which are then yours like any you typed: every listing title and album
  page in that language uses them at once, and you check them where they are shown. Nothing marks
  them as written by an assistant.

**It never replaces a translation you already have unless it is told to**, and when it does, it says
which translation it replaced. A language you do not list or print in is refused, and so is your
collection's own language, whose texts are the names themselves. It does not remove a translation.
**An album card already printed stays exactly as it is**: a translation that changes what a printed
card says shows up on the album as a difference, as any other change to its text does, and deciding
what to do about it stays with you.

**And there is one thing it can answer about a stamp you do not own and have not recorded: what a
lot at auction would be worth bidding.** Tell it what the auctioneer says the lot holds — the
stamps, the grade, whether there is a certificate, whether it is a block rather than singles, how
many — and it comes back with three figures: a floor under which the lot is a bargain, a fair figure
your own recorded results support, and a walk-away past which it belongs to somebody else. If the
opening price is above the walk-away, that is the end of it, and you never had to look. It is the
same arithmetic the *Recommended* figure on your own lots screen shows, out of the same code, so the two
cannot tell you different things. Nothing is created by asking — no lot, no sale, nothing on your
watchlist — and a **read only** token can ask it.

Three things about that answer are worth knowing before you act on one:

- **Tell it the buyer's premium if you know it.** Each figure comes twice — what the lot is worth
  all-in, and the hammer price that still fits inside that once the premium is added. Without the
  premium the two are the same number, which **overstates what you can actually bid**. The answer
  says which fees it used, so you can see when none were given.
- **A figure it cannot work out is not a figure of nought.** It tells you separately when nothing
  prices a stamp at all, when there *is* a price it cannot convert into the auction's currency, and
  when the premium alone eats the whole figure. The last one is the clearest *do not bother* there
  is, and reading it as zero would be the opposite of what it means.
- **Ask about one grade at a time.** A lot that is half mint and half used cannot be answered in one
  question, and two answers do not add up — a flat lot fee is charged once, not twice.
- **A certificate with no price of its own is worked out, and said.** When the lot carries a
  certificate your catalogue has no price for, the figure comes from the price without one times
  that certificate's percentage, exactly as on the lots screen, and the answer says *derived from
  None × 120%*. A certificate without a percentage derives nothing, and the answer says that is why.

**It can also read the auctions you are already following**, which is what lets it tell a listing in
this morning's mail from one it told you about yesterday. It can list your open lots — when each
closes, what the auction stands at, what you bid, your ceiling, and whether you are leading or
outbid — and say what those lots can cost you, which are the *Committed* and *At ceiling* figures
above your lots list. And it can take a batch of Allegro links or offer numbers and tell you for each
whether you already track it, which lot it is, and how it ended if you have closed it. The figures
come out of the same code your lots screen uses, so it cannot give you a different number from the
one you would see there.

- **Reading needs only a read only token.** Listing, costing and recognising lots changes nothing.
- **Whatever it ever writes to your auctions waits for you.** Every lot or sale written through the
  agent API is marked **To review · API**, saying what was added or changed and when — except a
  refreshed current bid, which is only the assistant looking — and only you
  can clear that mark — by pressing **Confirm** on the lot, on the lots you tick, or on the whole
  sale. Editing the lot yourself does not clear it. See
  [What the assistant wrote](auctions.md#what-the-assistant-wrote--to-review--api).
- **A price is as fresh as your last check.** Bids are refreshed by hand, so each lot says when its
  price was last looked at; an old check means an old price.
- **Lots you have closed are not on the list**, but it still recognises their listings and says how
  they ended.
- **It recognises an Allegro offer number, not a house's lot number.** A listing at another auction
  house is recognised by the address saved on its lot, never by `Lot 42`, which means something
  different in every house's catalogue.

**And once you decide to bid on a listing it found, it can put the lot on your watchlist for you**,
with a writing token, instead of you typing it in. It can:

- **add the lot** — where it is listed and who sells it, its address and number, title, starting
  price, closing time, the stamps in it, its tags and a ceiling. The lot lands in the sale it belongs
  to by the same rule as **Add lot**: on Allegro the seller's open sale; on Philasearch the house's
  open sale *of that name* (*Köhler 385*), since a house's next auction is a new parcel. A sale it
  starts takes the seller's usual premium and shipping.
- **say what is in it** — each stamp with its grade, and where the listing does not say the grade,
  the grades it may be in (*MNH or MH*) or *unknown*, exactly as you can on the lot yourself. A lot
  that is not stamps can be marked so.
- **set or clear the ceiling**, with a note on how it worked it out, which you can read by hovering
  the ceiling.
- **record what the auction stands at**, with when it looked, and **correct** the lot's title,
  number, address, closing time, starting price and tags, and a sale's name, address, closing time,
  currency, premium and shipping.
- **record how it ended** — the lot closed with what it went for, or cancelled, exactly as **Close
  the lot** and **Mark as cancelled** do. It never says *won* or *lost*: that follows from the final
  price against your own bid, as it does when you close a lot yourself, so a lot reads the same
  whichever of you closed it. A lot you bid on needs its final price — if the result was never seen,
  it stays open for you; one you only watched can be closed without one. Sending a different price
  later corrects it.

A listing you already track is never added twice: it is refused, and the assistant is told which lot
has it. **It never bids**: it does not touch *my bid* — the bid you place by hand on the platform —
and it does not reopen a lot or settle one into a purchase — a won lot waits for you to settle the
parcel, as before. **Every lot and sale it writes is marked
*To review · API* until you confirm it**, apart from a refreshed current bid, which leaves the mark
as it was. A seller you have never bought from is not created by
adding a lot; the assistant adds them as a contact first, as it does for a purchase.

**It can record what stamps fetched at other people's auctions**, with a writing token — the
realised prices it reads off Philasearch or a house's results, often a whole page at a time. They are
your [price observations](collections.md#price-observations), exactly as if you had typed them into
a stamp's Valuation dialog, and they count in the same way: an exact one from a market that anchors
the stamp's area moves its market value and the bid recommendations; anything else is kept as a
hint. It can:

- **record a page of results** in one go. Each one is answered on its own — recorded, already
  recorded, or refused with the reason — and one it cannot place stops none of the others. For each
  recorded one it is told at once whether it counts, and if not, why.
- **list what is already recorded** — for a stamp, an area, a market, a platform, a house or a span
  of days — and **correct** or **delete** one it misread.

What it will not do with them:

- **It never guesses a stamp.** A catalogue number that names several of your stamps, or none, is
  refused. One that names only a stamp with variants is recorded on that stamp, as a hint, until it
  is corrected onto the variant.
- **It never records the same lot twice.** A result with the same address, or the same lot number in
  the same auction at the same house, as one already recorded is answered *already recorded*. This
  holds in the Valuation dialog too.
- **It never makes up an auction house.** A house that is not in your Contacts is refused; the
  assistant adds it first, with the country it sells in, so its results count in the right market. A
  house you already have keeps whatever market you gave it — the assistant cannot change one.
- **It cannot change your bids, lots or purchases from here** — a price observation is a fact about
  the market, never something you did.

When it explains a bid recommendation, each result it rests on comes with the observation's id, so a
misread one can be corrected on the spot.

**Everything it writes is on a screen you already know, and is undone there.**

**Which is exactly why *read only* is the setting to start from.** A listing drafted at the wrong
price is a minute to fix, and it is still a minute you did not plan to spend — so let an assistant
look around your collection first, and hand it a writing token when you know what you want it to do.

Two things it will never do, however you ask, and they are absent rather than switched off:

- **It never publishes to a marketplace.** It can draft, price and title an offer inside
  Stamporama; putting it in front of the public stays with you. An assistant that misreads costs you
  a minute, and one that mispublishes lists a stamp at the wrong price under your name on somebody
  else's platform.
- **It never reaches a counterparty.** It can build and balance a trade; it does not send a
  proposal, share a link, agree or close a trade, answer what a partner wrote on one, or write to
  Colnect. Nor does it bid on anything: working out what a lot is worth and keeping your watchlist
  is as far as it goes, and typing a figure into an auction house's box stays with you. It also never sees a partner's email address, telephone number or the notes you keep
  about them — the only thing it is told about a person is their name.

And with a **read only** token it changes nothing at all, which is the setting to start from.

## For a client that speaks plain HTTP

If what you have is a script rather than an MCP client, the same operations are available as an
ordinary REST API at `/api/v1`, with the same token. `GET /api/v1/openapi.json` — which also needs
the token — describes everything the instance offers, so most HTTP tooling can be pointed straight
at it.
