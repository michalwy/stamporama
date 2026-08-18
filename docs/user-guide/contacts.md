# Contacts

**Contacts** are the address book of everyone you deal with as a collector — sellers,
buyers, exchange partners, auction houses, and the platforms you trade through (Allegro,
eBay, Delcampe). Contacts are scoped to a collection: each collection keeps its own list.

Open the **Contacts** screen from the sidebar — it sits below **Selling** and **Buying**, because
the same address book serves both.

## Roles

A contact can carry any combination of **roles**, or none at all:

- **Seller** / **Buyer** — someone you buy from or sell to.
- **Exchange partner** — someone you swap stamps with.
- **Auction house** — e.g. Cherrystone, David Feldman.
- **Platform** — an online marketplace a purchase, offer, or sale is routed through. Some platforms
  have settings of their own beyond the contact form: see [Allegro](allegro.md) and
  [Delcampe](delcampe.md).
- **Other** — anyone who doesn't fit the above.

Roles are just labels: they show as badges on each row and let you filter the list. A
contact created automatically while recording a purchase starts with no roles — open it
and tick the ones that apply.

## Adding and editing

Click **Add contact** and fill in the **name** (required), optional **full name**, **email**,
**phone**, **notes**, and the **roles**. Names must be unique within the collection.

**Name** is who they are *to you* — what you file them under and what every picker searches.
**Full name** is the name on the paperwork, and only needs filling in when it differs. That is the
ordinary case for a marketplace buyer: you know them as `bronek_1980`, and the parcel has to say
*Bronisław Włoch*. Recording a sale from an [Allegro order](allegro.md) fills it in for you, on a
contact that has none.

### Tabs follow the roles

A plain address-book contact is one short form. Tick **Platform**, or **Seller** / **Auction house**,
and the dialog grows **tabs** for what that role brings with it:

- **Contact** — name, full name, email, phone, roles and notes. Always there, and where you land.
- **Platform** — currency, listing language, default listing type and starting price, listing templates, listing text
  limits and offer photos. Appears with the **Platform** role.
- **Auction defaults** — the currency and fee terms a seller trades on. Appears with **Seller** or
  **Auction house**.

The tabs are **grouping only**: it is still one record with one **Save changes**, and what you typed
on a tab you are not looking at is saved with everything else. Untick a role and its tab goes, along
with the settings it held — which is how you clear them.

Everything below describes the **Platform** and **Auction defaults** tabs.

Ticking **Platform** reveals a **Platform currency** field. This is the one currency every
[offer](offers.md) and [sale](sales.md) on that platform uses — it is inherited and locked there,
so an offer and its sale can never disagree. You can set it here, or leave it unset and pick it
inline the first time you list or sell on the platform. Changing it later leaves existing offers
and sales untouched — each keeps the currency it was created with.

Ticking **Platform** also reveals a **Default listing type** — how a new offer here is sold, for a
marketplace you only ever auction on (or never do). It pre-selects **Quick buy** or **Auction** in
the new-offer dialog and is changeable per listing; leave it at **no preference** and a new offer
starts as a quick buy.

Choosing **Auction** reveals a **Default starting price** beside it — the figure a house you always
open at the same price starts at, in the platform's own currency. On an auction it **wins**: a new
auction opens at it even when the goods themselves suggest a price — the lot's suggested price and
the copies' catalog value fill the same field, but only when the platform states no opening figure,
because an auction is opened deliberately below what the goods are worth, to attract bids. It never
touches the offer's current price, which stays empty until somebody bids, and whatever it fills in is
yours to edit on the offer. Leave it empty for houses you open individually.

There is deliberately no default price for a **quick buy**: its price follows from the goods, which
is exactly what those two suggestions already answer.

Both are read when the offer is created and never afterwards, so what they filled in stays yours to
edit on the offer, and changing either here leaves offers already created untouched.

Ticking **Seller** or **Auction house** reveals **Auction sale defaults** — the **currency**,
**shipping**, and the two **buyer's premium** parts (a percentage and a per-lot fee) this seller
normally trades on. They are **copied onto every new [auction sale](auctions.md)** with this seller
and are edited on the sale afterwards, so raising a premium here never re-prices a parcel you are
already bidding on. Currency sits on the seller rather than the platform because an aggregator
carries houses listing in EUR, CHF and GBP alike.

A seller also quietly remembers **which platform you last tracked a lot with them on**, and it
pre-fills the platform next time you name them. There is no field for it — it is written whenever
you add a lot or start an auction sale, and deleting the platform contact simply forgets it.

Ticking **Platform** also reveals a **Listing language** — the language this platform's listings are
written in. Pick the one it uses; platforms that write in your collection's
[default language](collections.md#default-language) need nothing further, and neither does leaving it
on **— default language —**. The language does two things: generated titles for this platform use the
text you entered for that language, and the languages that *differ* from your default are the ones the
entity forms offer translation fields for. Nothing is translated automatically — where you have not
entered text for a language, the default text is used, so a title is never left with a gap. Every
token that renders text you typed is translatable: the area
[title name](#title-names-per-language), [condition and certificate status](collections.md#conditions-in-other-languages)
names and abbreviations, and [issue and stamp names](collections.md#issue-and-stamp-names-in-other-languages).

Ticking **Platform** also reveals **Listing templates** — what this platform's [offer](offers.md)
texts are pre-filled from. Click **Templates…** to open the templates dialog, which holds all five,
one under another:

| Template | Fills in | Left blank |
| --- | --- | --- |
| **Listing title** | the offer name and set/lot titles | falls back to the catalog/copy label |
| **Listing description** | the offer's long listing description | no description is generated |
| **Private note** | the seller-only note some platforms allow on a listing | no note is generated |
| **Photo tile label (left)** | the annotation written under each stamp, flush left — usually its location ref | that side stays blank |
| **Photo tile label (right)** | a second annotation on the same strip, flush right, at the same size | that side stays blank |

At the top of the dialog is **Preview on** — the inventory copies every preview below runs on, shared
by all three so they always describe the same stamps. **🎲 Random** reshuffles them and **Pick copy…**
searches out a specific one. Two copies are used, each treated as its own set, so a repeating block
(see below) previews the way it will read on a real offer. The dialog is a fixed size and scrolls
inside, and each template **collapses to a single row** (click its heading) so the one you are
writing has the room — a collapsed row still shows its template on one line, with `⏎` for the line
breaks. **Save templates** saves them all at once; platforms that have no private note simply leave
that one empty.

The two photo tile labels behave a little differently from the other three: they are **copied onto
each new offer** on this platform rather than read from here when photos are generated (see
[Offer photos](#offer-photos) below), so a buyer asking about a label on an image you already
uploaded keeps getting the same label.

Each template is the same **template builder**: a field, its token chips, and a live preview
underneath. You write the template with **tokens** in curly braces mixed with any literal text you
like, for example `{catalog} {name} {year} {condition}`. Click a token chip to drop it in at the
cursor. The preview renders in the platform's **listing language**, so you see the text as its
listings will read — any word for which you have not entered text in that
language is dotted-underlined and named in a line beneath the preview (*default language used for
{condition}*), so you can spot the gaps while you write the template. Nothing is blocked: the title
always generates, falling back to your default text. The tokens fill in from the copies in the offer (or set):

- `{name}` — stamp name
- `{catalog}` — catalog number (configurable, see below)
- `{year}` — stamp year (a range like `1850–1867` when copies span several)
- `{condition}` — condition (full name)
- `{conditionAbbr}` — condition abbreviation (e.g. `MNH`)
- `{certificate}` — certificate status (full name)
- `{certificateAbbr}` — certificate-status abbreviation
- `{area}` — area (uses each area's optional **title name**, rolling up to a parent when blank — see below)
- `{location}` — the copy's storage location name
- `{ref}` — the copy's free-text reference within that location (e.g. `A234`)
- `{itemNo}` — the copy's [internal number](inventory.md#internal-copy-number), padded to the width
  set in **Settings → General**. Write `{itemNo:3}` to pad to a different width just here (`042`),
  or `{itemNo:1}` for no padding at all. No `#` is added — type one in the template if you want it.
- `{issueName}` — name of the issue the stamp belongs to
- `{issueYear}` — year of that issue (also collapses to a range across copies)
- `{subtype}` — the stamp's [subtype](collections.md#stamp-subtypes) (`Error`, `Overprint`, …).
  Empty for a top-level stamp and for anything on your collection's **default** subtype, so ordinary
  variants do not gain a redundant word — pair it as `{subtype|condition}` if you want something
  there either way.
- `{format}` — the copy's [physical format](inventory.md#pairs-blocks-and-other-multiples)
  (`Block of 4`, `Horizontal pair`, …), and `{formatAbbr}` for its abbreviation. **Empty for a
  single**, which is most copies — a single has no format at all — so the surrounding separator
  disappears with it, and a line that says nothing else is dropped whole. A batch mixing formats
  lists the distinct ones, `/`-separated, the way every other per-copy token does; the singles in
  it simply contribute nothing.
- `{setTitle}` — the set's own title, on the description and private-note tabs (blank unless you
  named the set, so pair it as `{setTitle|catalog}`)
- `{offerUrl}` — a link straight to this offer in Stamporama, on the description and private-note
  tabs. Unlike every other token it describes the *offer* rather than the stamps in it, which is what
  makes it useful in a **private note**: from the marketplace listing you are looking at, one click
  back to the copies, photos and location refs behind it. It renders the offer's
  [short address](offers.md#offer-number-and-short-link) — `https://your-instance/o/main/42`, around
  forty characters, which matters because Colnect's note field holds only a hundred and refuses
  anything longer outright. The link is built from the address this instance is reached at
  (`BETTER_AUTH_URL`); if that is not set, the token stays empty and takes its line with it — a
  half-written link on someone else's site helps nobody. Its preview shows an example address, since
  the offer does not exist yet while you are writing the template.

  Marketplaces generally print a private note as plain text, so the link is not clickable on their
  page by itself. The [Assistant](assistant.md#clickable-stamporama-links) turns it into a real link
  where it can.

Literal text between tokens — spaces, `-`, `/`, `:`, `=` — is kept as written; it only disappears
when it was gluing on a token that turned out empty. Use `{a|b|c}` to show the **first non-empty** of several
tokens: for example `{issueName|name|catalog}` prefers the issue name, falls back to the stamp name,
then the catalog number.

### Description and private note

The **Description** and **Private note** tabs work the same way, with two additions for longer text:

- **Line breaks are kept** as you write them, including blank lines between paragraphs. A line whose
  tokens *all* come out empty is dropped whole, so a line like `Certificate: {certificate}` leaves no
  stray `Certificate:` behind on a copy that has none.
- **Repeating blocks** list an offer item by item. `{#set}…{/set}` repeats its body once per set in
  the offer, and `{#copy}…{/copy}` once per copy — inside a set block, that set's copies; on its own,
  every copy in the offer. Inside a block, the tokens describe *that* set or copy rather than the
  offer as a whole. The chips insert a block around whatever you have selected.

For example:

```
{name} {year} — {condition}

Items in this lot:
{#set}- {catalog} {name}
{/set}
Shipped tracked within 3 working days.
```

### Description format

The **Listing description** section also carries a **Format**, because marketplaces disagree about
what their description field accepts:

| Format | Choose it when | On the offer |
| --- | --- | --- |
| **Plain text** | the field shows what you type, line breaks and all | shown as written |
| **HTML** | the field takes tags | shown rendered, with a **Source** switch back to the tags |
| **Markdown** | you would rather write Markdown than tags | shown rendered; the formatted copy is its rendered HTML |

With HTML or Markdown chosen, the template's own preview gains a **Rendered** button that shows the
description the way the platform will — the default **Source** view stays, because only it can mark
the words that fell back to your default language.

Like the photo defaults, the format is **copied onto each new offer** on this platform: changing it
here never re-reads a listing you have already written. Each offer can also be switched on its own
(see [Listing text](offers.md#listing-text)). The private note has no format — it is a note to
yourself, and the platforms that offer one treat it as plain text.

### A legend of the abbreviations used

Three more blocks repeat over the **distinct conditions, certificate statuses and formats** the
offer's copies actually use, rather than over its items: `{#conditionLegend}…{/conditionLegend}`,
`{#certificateLegend}…{/certificateLegend}` and
`{#formatLegend}…{/formatLegend}`. Each runs its body once per entry, in the order the
entries first appear, so you can spell out the abbreviations a description prints — in whatever
format you like, since the entry's layout is what you write inside the block:

```
{#copy}{catalog} {name} — {conditionAbbr}
{/copy}
Abbreviations used:
{#conditionLegend}{conditionAbbr} = {condition}
{/conditionLegend}
```

which comes out as, say:

```
Mi 12 Mercury — MNH
Mi 13 Venus — U

Abbreviations used:
MNH = Mint never hinged
U = Used
```

The block is named `…Legend` so it is never confused with the `{condition}` / `{certificate}` tokens
you write *inside* it. Inside such a block every *other* token narrows to the copies carrying that
entry too, so `{#conditionLegend}{conditionAbbr}: {catalog}{/conditionLegend}` reads `MNH: Mi 12,14`.
Copies with no condition (or no certificate) recorded contribute no entry — and by the same rule
**singles never appear in `{#formatLegend}`**, since a single carries no format. An entry whose
dictionary row has no abbreviation set renders its full name alone — the ` = ` glue disappears with
the empty token, as usual. Keep the body on one line if you prefer the legend inline, e.g.
`{#conditionLegend}{conditionAbbr} = {condition}, {/conditionLegend}` — the separator is literal
text, so the last entry keeps its trailing comma.

### Saying that the variant was not identified

Some pieces cannot be pinned down to one specific variant — a shade needs comparison material, a gum
variety is unidentifiable on a used stamp. Stamporama lists such a copy under its **cheapest**
variant (see [Offers](offers.md)), which means the marketplace page names one particular variant
while the piece in the envelope might be any of them. `{#unknownVariant}…{/unknownVariant}` is how
your description says so:

```
{#copy}{catalog} {name} — {conditionAbbr}
{/copy}
{#unknownVariant}The variant is not identified — this is one of {variants}.
It is offered under {listedAs}.
{/unknownVariant}
```

- `{listedAs}` is the variant the listing stands under, e.g. `Mi·PL 865a`.
- `{variants}` is what it might be — the stamp's own variants, collapsed into a range the same way a
  title collapses catalog numbers, e.g. `Mi·PL 865a-c`.

The block renders **nothing at all** when nothing in the offer is unidentified, so a template can
carry it permanently. Written at the top level it states the caveat once for the whole listing;
written *inside* `{#copy}` it becomes a per-copy aside, appearing only on the lines it applies to:

```
{#copy}{catalog} {name}{#unknownVariant} (offered as {listedAs}){/unknownVariant}
{/copy}
```

Everything inside the block describes only the unidentified copies, never the identified ones beside
them in the same listing — so `{catalog}` there names exactly the pieces the sentence is about.

`{listedAs}` is empty on a platform that is not listed against a catalogue (that is, one with no
Colnect connection set up in Settings → Colnect), and on a piece whose variant tree the app cannot
resolve yet — for instance while some of the variants still have no catalog price. Give it a line of
its own, as above: a line whose placeholders all came out empty is dropped whole, so the caveat still
reads properly when there is no variant to name.

Both tokens and the block are for the description and the private note only: put one in a **title**
and it renders empty, since a title has no room for the caveat and a range there would read as a span
you are selling.

Blank means *no text is generated at all* for that field — unlike the title, there is no built-in
default.

### Catalog numbers

A stamp can carry catalog numbers from several vendors (Michel, Scott…), and each number's full
identity is a **catalog prefix** (the vendor abbreviation, e.g. `Mi`) + an **area prefix** (e.g. `PL`)
+ the number (`200`) — shown as `Mi·PL 200`. The `{catalog}` token is configurable so you control
exactly what appears, with the syntax `{catalog:VENDORS:FLAGS}`:

- **VENDORS** — which vendors' numbers to show: a comma list of abbreviations (`Mi`, `Mi,Sc` — shown
  in that order), `*` for **all** vendors on the stamp, or blank for the area's **primary** vendor.
- **FLAGS** — which prefixes to show: `vendor` (the catalog prefix) and/or `area` (the area prefix),
  comma-separated (short forms `v` and `a` also work). **Omit** the flags segment to show **both**
  prefixes; give an **empty** segment to show the **bare number**.

Examples:

| Template | Result |
| --- | --- |
| `{catalog}` | `Mi·PL 200` (primary vendor, both prefixes) |
| `{catalog:Mi:vendor}` | `Mi 200` |
| `{catalog:Mi:vendor,area}` | `Mi·PL 200` |
| `{catalog:Mi:}` | `200` (bare number) |
| `{catalog:Mi,Sc:vendor}` | `Mi 200 / Sc 150` |
| `{catalog:*:vendor}` | every vendor's number, with its abbreviation |

When several copies are listed together, their numbers are grouped per vendor and **consecutive ones
collapse into ranges** — `Mi·DR 1` + `Mi·DR 2` becomes `Mi·DR 1-2`, and a gapped set reads
`Mi·DR 1-2,4,6-10`. Different vendors are shown separately, joined with ` / `.

Numbers that share a prefix or suffix collapse too, with the shared part written **once** around the
span: `BL31`, `BL32`, `BL33` reads `BL31-33`, and `40A`, `41A`, `42A` reads `40-42A`. Numbers whose
prefix/suffix differ belong to different numbering families and are folded separately — Michel
`1294CKB`, `1295CKB`, `1296KB` reads `1294-95CKB,1296KB`. Each catalog is evaluated on its own, so
one catalog's mixed numbering never stops the others from collapsing.

A range's **end drops the digits it shares with its start**, the usual catalog shorthand:
`1298`…`1302` reads `1298-302`, `1298`…`1299` reads `1298-99`, `240`…`256` reads `240-56`. At least
two digits always survive, and a range whose endpoints have different digit counts (`98`–`102`) is
written out in full, where a shortened end would read as a smaller number. The same shorthand is used
wherever a range is *shown* — an issue's declared catalog range on the Issues list, a derived
[offer set](offers.md) or [auction lot](auctions.md) name — but never where you are **entering or
confirming** one: the issue form's First/Last fields and the range-extension prompts always spell out
both endpoints, because those are the values being stored.

Letter and Roman-numeral **suffixes** on the same number collapse the same way, with only the suffix
written twice: Fischer `BL92a` + `BL92b` reads `BL92a-b`, and `12I`, `12II`, `12III` reads `12I-III`.
As with numbers, only consecutive ones fold — `92a` + `92c` stays `92a,92c`.

A catalog number that **is** a Roman numeral, with no number in front of it, collapses too: `I`, `II`,
`III` reads `I-III`. A numeral never folds into an ordinary number, so `1`, `2`, `I`, `II` reads
`1-2,I-II`.

A numeral may carry a **letter suffix**, and both parts fold. With the suffix constant the numeral
runs and the suffix is written at both ends — `IA`, `IIA`, … `VIIIA` reads `IA-VIIIA` — because
`I-VIIIA` would read as a plain numeral span with a stray letter on it. With the numeral constant it
is the suffix that runs, written once as usual: `Ia`, `Ib`, `Ic` reads `Ia-c`. An **uppercase**
suffix does not fold on that second axis (`IA` + `IB` stays `IA,IB`), and a suffix that is itself a
Roman digit — the `C` of `IC` — is read as part of the numeral, since nothing can tell the two apart.

### Area names in titles

Your area tree often mixes public territories with **internal grouping** levels — e.g. `Poland ›
Second Republic`. Each area has a **Title name** (on the area in the Areas screen) that `{area}` uses.
By default it **equals the area's name** and stays in sync as you rename — so every area shows itself
out of the box. To make an internal grouping level defer to its parent, **clear its title name**:
`{area}` then walks **up** the tree to the nearest ancestor that still has one.

So for `Poland › { Second Republic, Third Republic, General Gouvernement }`: leave `Poland` and
`General Gouvernement` as-is (they show themselves), and clear the title name on `Second Republic` and
`Third Republic` so both roll up to `Poland`. You never touch the parent or the siblings.

#### Title names per language

Once a platform lists in a language **other than** your collection's
[default language](collections.md#default-language), a 🌐 button appears **beside** the area's
**Title name** field (which is then labelled with your default language, e.g. *Title name — English
(en)*). It opens a fixed-size dialog listing those languages — fill in the ones you care about and
leave the rest blank; the list scrolls inside the dialog, so it stays the same size however many
languages you add. A small number on the button counts the languages still **missing** a translation
(they fall back to the plain title name); fill them all in and the number disappears.

**Done** closes the translations dialog and carries your entries back to the area — they are written
only when you save the **area** itself, so cancelling the area dialog discards the translations along
with everything else you changed there. The same dialog handles conditions, certificate statuses,
stamp subtypes, issue names and stamp names, always beside the field it translates: where an entity has **two**
translatable fields (a condition's name and its abbreviation), each gets its own 🌐 and its own
dialog, so a badge always tells you about exactly one field.

The roll-up and the language are independent: the roll-up decides **which area** names the title, and
the language only decides **how that area is written**. So with `Poland` set to `Poland` plus a Polish
`Polska`, a Polish platform lists `Second Republic` copies as `Polska` (it rolls up to `Poland`, then
uses the Polish spelling), while `General Gouvernement` — which has its own title name but no Polish
one — stays `General Gouvernement` rather than borrowing its parent's `Polska`. A blank language field
always means "use the plain title name", never "use the parent".

When an offer or set covers several copies, each token lists the distinct values it finds. Different
platforms have different title conventions and length limits, so each keeps its own template. **Leave
it blank** to fall back to Stamporama's plain catalog/copy label. Generated titles are only a
starting point — you can always edit an offer's title by hand afterwards (see
[Offers → Listing title](offers.md#listing-title)).

### Shipping methods

Ticking **Platform** also reveals a **Shipping methods** row with a **Methods…** button. This is the
platform's own postage price list — the services buyers here can choose from, each with what sending
by it costs *you*:

| Method | Carrier | Cost | Currency |
| --- | --- | --- | --- |
| Registered letter | Poczta Polska | 12.00 | PLN |
| Courier | DPD | 25.00 | PLN |

**Carrier** is optional and is only a **default**: it says who *usually* moves a parcel sent this
way, and is pre-selected when you mark a sale sent — where you change it if this one went with
somebody else. That matters because a marketplace sells a service, not a company: Allegro's
"Courier" is whichever courier you walk it to. Naming one is what lets a sale's
[tracking number](sales.md#tracking-the-shipment) become a link to the carrier's own tracking page.
Carriers are kept per collection under **Settings → Shipping**, not per platform — the same post
office carries parcels for every marketplace you sell on.

Add a row by filling in the fields at the bottom and pressing **+**. Each row's **⋮** menu
edits or deletes it; a delete confirms on the row itself. Names are unique per platform, so two
"Courier" rows can't shadow one another — but two different platforms can each have their own
Courier at their own price. The list is available once the contact has been saved: a method has to
hang off a platform that exists.

Unlike everything else in this dialog, these rows **save as you edit them** — they are records of
their own, not fields of the contact, so nothing here waits for the contact's **Save**.

Picking a method on a [sale](sales.md) fills in **my shipping** with the cost above, still editable
there — a method's price is what it usually costs, not what a particular parcel cost. Re-pricing or
renaming a method never touches a sale already recorded: each sale keeps the name it was sent under.
That is also why a method a sale points at can't be deleted — rename it instead. A sale can always
name a **one-off** method without one being listed here, so the list is for what you actually post
with regularly.

### Listing text limits

Under the templates sits **Listing text limits** — **Max title (characters)**, **Max description
(characters)** and **Max private note (characters)**. These are the platform's own hard caps: how
much text its listing form will physically accept. Colnect, for example, takes 100 characters for
each of its two texts. Leave a field blank when the platform states no limit, which is the usual
case.

They are recorded per platform, and separately per field, because platforms cap the texts
independently. Once one is set, a **character counter** appears wherever that text is written or
copied — beside the title in the offer's header, on its
[Listing text](offers.md#listing-text-description-and-private-note) card and in the
[bulk listing kit](offers.md#the-posting-kit) — turning amber and saying by how much once a text runs
over.

The title cap does one thing more, on [Delcampe](delcampe.md#the-title-cap): its listings are created
from a file Stamporama builds, and a title over the cap **refuses the export** rather than being
discovered when Delcampe rejects the upload.

Nothing is ever truncated against these limits. The text is yours; the counter only makes sure you
learn about the cap while writing rather than in the platform's form. They are read **live**, like the
photo limits below: correct a limit here and every offer's counter follows at once, including
listings you prepared earlier.

### Offer photos

Ticking **Platform** also reveals an **Offer photos** group. It works on two levels.

The three fields on the first row — **Max photos**, **Max longest edge (px)** and **Max file size
(MiB)** — are the platform's hard limits: what it will physically accept when you upload. Leave a
field blank when the platform states no limit for it. These are read **live** whenever photos are
generated, so tightening a limit applies to every offer at once, including ones you prepared
earlier.

Below them sit the defaults each **new** offer on this platform is seeded from:

- **Sides to photograph** — *Front only*, *Back only*, or *Front and back*.
- **Collage template** — which of your [collage templates](collections.md#collage-templates)
  supplies the render numbers (rows, columns, gap, background, label strip). Leave it on *none* and
  new offers simply start without collage numbers until you pick a template on the offer itself.
- **Single photos while the photo limit allows** — whether a new offer here photographs its
  single-stamp sets one per image while *Max photos* above has room, collaging only what is left
  over, or always collages them (see
  [single photos and the limit](offers.md#single-photos-and-the-limit)). On unless you say
  otherwise: the limit right above it is the very fact the rule reads, so a platform is where a
  collector who always wants collages says so once.

These — plus the **photo tile labels** from the templates dialog — are **copied onto the offer**
when it is created, not looked up later. Changing them here therefore affects only offers you create
from now on; offers already prepared or listed keep exactly the photos they were set up with. Adjust
one of those on the offer itself, with the **⚙** button in its Photos card (see
[Offers → Photo settings](offers.md#photo-settings)).

Every contact row has a **⋮** menu with **Edit** and **Delete**. Editing replaces all the
details and roles with whatever the dialog shows when you save.

## Finding a contact

Use the **search box** to filter by name, and the **role chips** to show only contacts of
a given role. The two combine — e.g. search "Jan" with the **Seller** chip active shows
only sellers whose name contains "Jan".

The search reads the **full name** as well as the name, so a buyer filed under their marketplace
login is still found by the name you remember them by.

## Deleting

A contact can only be deleted once nothing references it. If it is still used by one or
more **purchases** (as the supplier or the platform), the **Delete** action is disabled
and the row shows how many purchases use it — detach it from those
[purchases](purchases.md) first. This keeps purchase history from losing who it was with.
