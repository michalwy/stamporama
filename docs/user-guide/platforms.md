# Platforms

A **platform** is a marketplace you sell or buy on — Allegro, Delcampe, a Facebook group, eBay, a
collectors' forum. Every [offer](offers.md) and [sale](sales.md) is made on one, a
[purchase](purchases.md) or an [auction sale](auctions.md) may name the one it went through, and a
[price observation](auctions.md) names the one it was sold on. Platforms are scoped to a collection:
each collection keeps its own.

A platform is not a [contact](contacts.md). The seller you bought from, the buyer you sold to and the
auction house are contacts; the platform is **where it happened**. A house that sells directly is
both — a contact that sells, and a platform of the same name.

## The two kinds

- **Module platforms** — **Allegro**, **Delcampe**, **Facebook**, **Philasearch** and **Colnect**.
  Every collection has exactly one of each, named after its marketplace, because the app knows how
  to work with them: [Allegro](allegro.md)'s account and listing profiles, [Delcampe](delcampe.md)'s
  upload file, [Facebook](facebook.md)'s groups, Colnect's catalogue and lists, and the lots the
  [Assistant](assistant.md) captures from Allegro and Philasearch. Each is configured on the
  **Platform** tab of its own page in **Settings → Selling** (Colnect's in **Settings → Partners**;
  Philasearch's page is that tab alone). They cannot be renamed or deleted.
- **Your own platforms** — any other marketplace, under **Settings → Selling → Platforms**: the list
  on the left, the selected platform's settings beside it. **Add platform** starts a new one; a
  platform is renamed and edited in place and saved with **Save**.

Names are unique within the collection, and none of your own platforms may take a module
platform's name.

## Switched on or off

Every platform has a **Switched on** box. A platform switched off is offered in **no platform
picker for a new record** — a new offer, sale, purchase, auction sale or price observation, the
quick-offer bar, the lot builder — and everything already recorded on it keeps showing it.

A module platform starts **switched off**: switch it on on its page when you start using that
marketplace. Until you do, the features hanging off it behave as if it were not set up — a lot the
Assistant captures from Allegro has nowhere to land, for example. Switch one of your own platforms
off when you stop using it: it leaves the pickers and keeps its history.

Typing a platform's name into a platform field still works the way it always did: an existing
platform of that name is used, and a new name becomes a new platform of your own.

## Deleting

One of your own platforms can be deleted once **nothing names it** — no offer, sale, purchase,
auction sale or price observation. Until then the **Delete** button is disabled and says how many
records name it; switch the platform off instead. What the platform owns — its shipping options,
listing profiles and the like — goes with it. A module platform cannot be deleted.

## The platform's settings

A platform's page is in four sections: the **platform** itself, what an **offer and a sale** on it
start as, the **listing texts**, and the **photos**. Everything below is the same on a module
platform's Platform tab and on one of your own.

### The platform

Besides its name and the switch, a platform has **notes** and a **Market** — the country it sells
in. A result's market is its auction house's, or its platform's when the house names none (see
[Markets — which results count](collections.md#markets--which-results-count)); left as *not known*,
results on it count as the collection's home market. Changing it re-judges every result already
recorded — nothing is stored on the results.

### Offers and sales

A platform's **Currency** is the one currency every
[offer](offers.md) and [sale](sales.md) on that platform uses — it is inherited and locked there,
so an offer and its sale can never disagree. You can set it on the platform, or leave it unset and pick it
inline the first time you list or sell on the platform. Changing it later leaves existing offers
and sales untouched — each keeps the currency it was created with.

A platform's **Default listing type** says how a new offer here is sold, for a
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

The Facebook platform does not show it: there the opening figure is one of Facebook's own settings,
on the Groups tab of **Settings → Facebook**, where it can also be a percentage of the copies'
catalogue value.

There is deliberately no default price for a **quick buy**: its price follows from the goods, which
is exactly what those two suggestions already answer.

Both are read when the offer is created, so what they filled in stays yours to edit on the offer, and
changing either here leaves offers already created untouched. The one place the starting price is
shown again is an auction whose starting price is empty — cleared, or created before you set one —
where the offer's screen offers it back beside the price as **platform default**.

A platform's **Minimum price** is the lowest figure worth listing on this
platform once its own fees are paid, in the platform's currency. Unlike the starting price above it,
it applies whatever the listing type is, and it applies for the whole life of an offer rather than
only at creation.

It fills in nothing by itself. It is a figure you ask back for: it appears as **min** on the price
line of an offer's own screen, and clicking it sets the price to it. Nothing is ever refused for being under it either —
this is a floor you choose to drop to, not one the app holds you to, because clearing a lot at cost
or giving something away is an ordinary thing to do.

It is shown even when the suggested price beside it is already higher, since a cheap common you mean
to list at the floor is exactly what it was added for. Leave it empty for platforms with no such
figure.

A platform also has **Refresh quick buys after (days)**: how long a quick buy may be up there before
it has sunk out of sight and wants posting again — a few days on Delcampe, never on Allegro. An
active quick buy up that long is marked on the offers list (see [Quick buys that need
refreshing](offers.md#quick-buys-that-need-refreshing)). Leave it empty for never. The Facebook
platform does not show it: there it is set on the Groups tab of Settings → Facebook, where each group
can follow it or set its own.

## Listing language

A platform's **Listing language** is the language its listings are
written in. Pick the one it uses; platforms that write in your collection's
[default language](collections.md#default-language) need nothing further, and neither does leaving it
on **— default language —**. The language does two things: generated titles for this platform use the
text you entered for that language, and the languages that *differ* from your default are among the
ones the entity forms offer translation fields for — the languages your [albums](albums.md#the-language-is-the-albums-own-and-it-changes-the-plan)
are printed in count too. Nothing is translated automatically — where you have not
entered text for a language, the default text is used, so a title is never left with a gap. Every
token that renders text you typed is translatable: the area
[title name](#title-names-per-language), [condition and certificate status](collections.md#conditions-in-other-languages)
names and abbreviations, and [issue and stamp names](collections.md#issue-and-stamp-names-in-other-languages).

## Listing templates

A platform's **Listing templates** are what its [offer](offers.md)
texts are pre-filled from. Click **Templates…** to open the templates dialog, which holds all five,
one tab each — the two photo tile labels share a tab, since they are the two ends of one strip:

| Template | Fills in | Left blank |
| --- | --- | --- |
| **Listing title** | the offer name and set/lot titles | falls back to the catalog/copy label |
| **Listing description** | the offer's long listing description | no description is generated |
| **Private note** | the seller-only note some platforms allow on a listing | no note is generated |
| **Photo tile label (left)** | the annotation written under each stamp, flush left — usually its location ref | that side stays blank |
| **Photo tile label (right)** | a second annotation on the same strip, flush right, at the same size | that side stays blank |

At the top of the dialog is **Preview on** — the inventory copies every preview below runs on, shared
by every tab so they always describe the same stamps. **🎲 Random** reshuffles them and **Pick copy…**
searches out a specific one. Two copies are used, each treated as its own set, so a repeating block
(see below) previews the way it will read on a real offer. Under it are the tabs — **Title**,
**Description**, **Private note** and **Photo tile labels** — each showing its template with the
preview beside it, so the dialog fits the window whichever you are writing; a long preview scrolls
inside its own box. **Template syntax**, at the end of the tab row, explains the token syntax when
you hover it. Switching tabs keeps what you typed, and **Save templates** saves all of them at once; platforms that have no private note simply leave
that one empty.

The two photo tile labels behave a little differently from the other three: they are **copied onto
each new offer** on this platform rather than read from here when photos are generated (see
[Offer photos](#offer-photos) below), so a buyer asking about a label on an image you already
uploaded keeps getting the same label.

Each template is the same **template builder**: a field, its token chips, and a live preview
beside it. You write the template with **tokens** in curly braces mixed with any literal text you
like, for example `{catalog} {name} {year} {condition}`. Click a token chip to drop it in at the
cursor. The preview renders in the platform's **listing language**, so you see the text as its
listings will read — any word for which you have not entered text in that
language is dotted-underlined and named in a line beneath the preview (*default language used for
{condition}*), so you can spot the gaps while you write the template. Nothing is blocked: the title
always generates, falling back to your default text. Each untranslated name in that line is a link
(*Netherlands → Polish*): click it to type that name in the listing language right there. It is saved
on the area, condition, stamp or issue itself — so it applies everywhere that name is used in that
language — and the preview re-reads at once; the line goes when nothing is left untranslated. The tokens fill in from the copies in the offer (or set):

- `{name}` — stamp name
- `{catalog}` — catalog number (configurable, see below)
- `{year}` — stamp year (a range like `1850–1867` when copies span several)
- `{condition}` — condition (full name)
- `{conditionAbbr}` — condition abbreviation (e.g. `MNH`)
- `{conditionSymbol}` — the condition's catalogue symbol (e.g. `**`), set in
  [**Settings → Conditions**](collections.md#stamp-conditions). A condition without one prints
  **nothing** — never its abbreviation instead — and the preview says so beneath it
  (*{conditionSymbol} is empty for Mint Hinged*). Write `{conditionSymbol|conditionAbbr}` if you want
  the abbreviation where no symbol is set. It works inside `{#copy}`, `{#set}` and
  `{#conditionLegend}` like the other condition tokens, and in the photo tile labels.
- `{certificate}` — certificate status (full name)
- `{certificateAbbr}` — certificate-status abbreviation
- `{area}` — area (uses each area's optional **title name**, rolling up to a parent when blank — see below)
- `{areaSymbol}` — the area's **symbol**, usually its flag (e.g. `🇳🇱`), set on the area in
  [**Catalog → Areas**](collections.md#area-symbol). Unlike `{area}` it **never rolls up**: an area
  without a symbol of its own prints **nothing**, even when its parent has one, and the preview says so
  beneath it (*{areaSymbol} is empty for Second Republic*). Where an offer spans several areas it lists
  their symbols in the same order and with the same ` / ` as `{area}`, leaving out the ones not set.
  It works inside `{#copy}` and `{#set}`, in the photo tile labels, and in an album's chapter headings,
  checklist headings and footers.
- `{location}` — the copy's storage location name
- `{ref}` — the copy's free-text reference within that location (e.g. `A234`)
- `{itemNo}` — the copy's [internal number](inventory.md#internal-copy-number), padded to the width
  set in **Settings → Collection**. Write `{itemNo:3}` to pad to a different width just here (`042`),
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
- `{denomination}`, `{perforation}`, `{color}`, `{watermark}`, `{paper}`, `{printing}` — what the
  catalogue says the stamp **is** ([stamp attributes](collections.md#stamp-attributes)): `10 gr`,
  `11½`, `Carmine`, `Lozenges`, `Thin paper`, `Photogravure`. Each is empty on a stamp that states
  nothing — which is most stamps until you have filled them in — so the separator around it
  disappears with it and a line that said nothing else is dropped whole. A batch listing several
  stamps joins the distinct values with `/`, like every other per-copy token. The four dictionary
  ones translate; a denomination and a perforation are printed as printed and never do.
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

## Description and private note

The **Description** and **Private note** tabs work the same way, with two additions for longer text:

- **Line breaks are kept** as you write them, including blank lines between paragraphs. A line whose
  tokens *all* come out empty is dropped whole, so a line like `Certificate: {certificate}` leaves no
  stray `Certificate:` behind on a copy that has none.
- **Repeating blocks** list an offer item by item. `{#set}…{/set}` repeats its body once per set in
  the offer, and `{#copy}…{/copy}` once per copy — inside a set block, that set's copies; on its own,
  every copy in the offer. Inside a block, the tokens describe *that* set or copy rather than the
  offer as a whole.

  Every block is listed in a **Blocks** row under the token chips; hover a block for what it repeats
  over and an example, and click it to wrap whatever you have selected. A token that only means
  something inside a block sits in that block's frame rather than among the others — `{setTitle}`
  beside `{#set}`, `{listedAs}` and `{variants}` beside `{#unknownVariant}`. The same row appears on
  every multi-line template, including a [bulk lot's description](offers.md#naming-the-listing).

  Blocks work only in these multi-line texts. A block typed into a title or a photo tile label stays
  in the text as typed, the way a misspelt token does, so you can see it is not doing anything.

For example:

```
{name} {year} — {condition}

Items in this lot:
{#set}- {catalog} {name}
{/set}
Shipped tracked within 3 working days.
```

## Description format

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

## A legend of the abbreviations used

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

## Saying that the variant was not identified

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

Both tokens and the block are for the description and the private note only: put a token in a
**title** and it renders empty, since a title has no room for the caveat and a range there would read
as a span you are selling — and the block stays as typed, like every block in a title.

## Telling a buyer about faults

A copy's [faults](faults.md) — a thin, a crease, a hinge remnant — are something a buyer is owed, so
a description can name them instead of you typing them into each listing:

- `{faults}` is the faults of the copies it describes, comma-separated, e.g. `Thin, Crease`. Inside
  `{#copy}` that is the one copy's; on its own, every fault any copy in the offer has.
- `{#faultyCopy}…{/faultyCopy}` repeats once per copy that **has** faults and skips the sound ones,
  so an offer of several pieces says which one is which:

```
{#copy}{catalog} {name} — {conditionAbbr}
{/copy}
{#faultyCopy}Faults of {catalog}: {faults}
{/faultyCopy}
```

which, for three stamps of which only the middle one is thinned and creased, comes out as:

```
Mi 12 Mercury — MNH
Mi 13 Venus — MNH
Mi 14 Mars — MNH
Faults of Mi 13: Thin, Crease
```

An offer whose copies are all sound gets no faults line at all, so a template can carry the block
permanently. Each fault is written in the **platform's listing language**, from the translation you
gave it in Settings → Faults; one with no translation is written as you named it and shows up among
the [missing translations](offers.md#filling-a-missing-translation-without-leaving-the-dialog) like
any other untranslated word. Nothing new appears on its own: the faults show only where your
template puts them. The empty **Listing description** box shows the block in its example.

Like the variant caveat, `{faults}` is for the description and the private note only — in a
**title** it renders empty, since a title is short and capped by the platforms.

Blank means *no text is generated at all* for that field — unlike the title, there is no built-in
default.

## Catalog numbers

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

A **piece carrying several stamps** — a cover, a fragment, an FDC (see
[Covers, fragments and other pieces carrying several stamps](inventory.md#covers-fragments-and-other-pieces-carrying-several-stamps))
— gets the catalog number of **every** stamp on it, not just the first, exactly as if those stamps
were listed loose: a cover franked with `Mi·PL 200`, `201` and `205` reads `Mi·PL 200-01,205`. The
catalogs come in the order you put the stamps in on the piece, each stamp keeps its own area prefix
(`Mi·PL 200 / Mi·DR 5`), and listed together with other copies its numbers join theirs into one
range. The other tokens — `{name}`, `{year}` and the rest — still describe the first stamp on the
piece.

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

## Area names in titles

Your area tree often mixes public territories with **internal grouping** levels — e.g. `Poland ›
Second Republic`. Each area has a **Title name** (on the area in the Areas screen) that `{area}` uses.
By default it **equals the area's name** and stays in sync as you rename — so every area shows itself
out of the box. To make an internal grouping level defer to its parent, **clear its title name**:
`{area}` then walks **up** the tree to the nearest ancestor that still has one.

So for `Poland › { Second Republic, Third Republic, General Gouvernement }`: leave `Poland` and
`General Gouvernement` as-is (they show themselves), and clear the title name on `Second Republic` and
`Third Republic` so both roll up to `Poland`. You never touch the parent or the siblings.

### Title names per language

Once a platform lists in — or an album is printed in — a language **other than** your collection's
[default language](collections.md#default-language), a 🌐 button appears **beside** the area's
**Title name** field (which is then labelled with your default language, e.g. *Title name — English
(en)*). It opens a fixed-size dialog listing those languages — fill in the ones you care about and
leave the rest blank; the list scrolls inside the dialog, so it stays the same size however many
languages you add. A small number on the button counts the languages still **missing** a translation
(they fall back to the plain title name); fill them all in and the number disappears.

**Done** closes the translations dialog and carries your entries back to the area — they are written
only when you save the **area** itself, so cancelling the area dialog discards the translations along
with everything else you changed there. The same dialog handles issue names and stamp names, always
beside the field it translates. The dictionaries in Settings — conditions, certificate statuses,
formats, subtypes and attributes — need no dialog: their pane has room for a box per language right
under the text it translates (see [Pages with a list](collections.md#pages-with-a-list)).

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

## Shipping options

A platform's **Shipping options** row has an **Options…** button. It opens
what buyers on this platform can choose from, **at the price they pay** for it, each linked to the
carrier service it goes by:

| Option | Sent by | Buyer pays | Currency |
| --- | --- | --- | --- |
| Registered letter | Poczta Polska › List polecony ekonomiczny | 9.00 | PLN |
| Courier | InPost › Kurier | 18.00 | PLN |

**What sending costs *you* is not set here.** It belongs to the carrier's service, in the rate list
under [Settings → Carriers](collections.md#carriers): the same registered letter costs you the same
whether the stamp sold on Allegro, Colnect or Facebook, so its price is kept once and every
platform's option links to it. A linked row also shows what the service costs you and the packing
supplies it usually takes.

**Sent by** is optional. Linking a service is what lets a sale fill itself in: picking the option on
a [sale](sales.md) fills in the **postage** with the service's cost and the service's usual
[packing supplies](sales.md#packing-supplies), all still editable there — the service's price is
what postage usually costs, not what a particular parcel cost. It also gives the sale a default
carrier, so its [tracking number](sales.md#tracking-the-shipment) becomes a link. An option linked
to no service leaves the postage for you to enter.

Add a row by filling in the fields at the bottom and pressing **+**. Each row's **⋮** menu edits or
deletes it; a delete confirms on the row itself. Names are unique per platform, so two "Courier"
rows can't shadow one another — but two different platforms can each have their own Courier at
their own price. The list is available once a new platform has been added: an option has to hang off
a platform that exists.

Unlike everything else on the platform's page, these rows **save as you edit them** — they are
records of their own, not fields of the platform, so nothing here waits for the page's **Save**.

Re-pricing or renaming an option, or its service, never touches a sale already recorded: each sale
keeps the name it was sent under and the postage it was given. That is also why an option a sale
points at can't be deleted — rename it instead. A sale can always name a **one-off** option without
one being listed here, so the list is for what you actually offer regularly. The buyer prices are
what the [message to the buyer](sales.md#message-to-the-buyer) lists for `{shippingOptions}`.

## Message to buyer

A platform's **Message to buyer** is the template of what you send a buyer after a sale here — what
to pay, the account to pay into, and what happens next. Placeholders under the field fill in the
sale's own figures; the [sales guide](sales.md#message-to-the-buyer) lists them and what each becomes.
Leave it empty and sales on this platform offer no message.

The Facebook platform has no such field here: its message is set on the Groups tab of
**Settings → Facebook**, where each group can follow it or have its own ([Facebook](facebook.md#buyer-messages)).

## Listing text limits

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

A cap is also **enforced at the Ready step**: an offer whose text runs over
[cannot be marked Ready](offers.md#a-text-over-the-platforms-cap) until it is shortened. Nothing is
ever shortened for you. Because caps are read live, tightening one here reaches offers that were
already Ready — they stay Ready, and the bulk listing screen reports them.

On [Delcampe](delcampe.md#the-title-cap) the title cap does one thing more: its listings are created
from a file Stamporama builds, and a title over the cap **refuses the export** rather than being
discovered when Delcampe rejects the upload.

Nothing is ever truncated against these limits. The text is yours; the counter only makes sure you
learn about the cap while writing rather than in the platform's form. They are read **live**, like the
photo limits below: correct a limit here and every offer's counter follows at once, including
listings you prepared earlier.

## Offer photos

A platform's **Photos** section works on two levels.

The three fields on the first row — **Max photos**, **Max longest edge (px)** and **Max file size
(MiB)** — are the platform's hard limits: what it will physically accept when you upload. Leave a
field blank when the platform states no limit for it. These are read **live** whenever photos are
generated, so tightening a limit applies to every offer at once, including ones you prepared
earlier.

**Cover symbols on offer photos** says whether this platform's offers need symbols covered on their
photos — a swastika or a portrait on German Reich material, which Facebook's rules punish. Like the
limits it is read **live**: turning it on reaches every offer on the platform that has not said
otherwise. **New covers start as** picks the style a newly drawn cover begins with — *Pixelate*,
*Blur* or *Solid bar* — and each cover can still be changed on its own. **Bars in** picks the colour
the first solid bar is drawn in — black, white, grey, stamp-paper cream or any colour you pick; after
that a new bar starts in the colour you last gave one on this browser. The Facebook platform starts
with it ticked. See
[Offers → Covering symbols](offers.md#covering-symbols).

Below them sit the defaults each **new** offer on this platform is seeded from:

- **Sides to photograph** — *Front only*, *Back only*, *Front and back*, or *Front and back,
  paired* ([what pairing does](offers.md#paired-front-and-back)). A collage template below whose
  **Front and back in one cell** is ticked upgrades a *Front and back* platform to the paired mode
  on every new offer, and leaves a one-sided platform as it is. Seeding only ever *adds* the
  pairing: set this platform to *Front and back, paired* and its new offers are paired whether or
  not the collage template below pairs — the template can turn pairing on for you, never off. To
  unpair, change the setting here, or on the offer itself.
- **Collage template** — which of your [collage templates](collections.md#collage-templates)
  supplies the render numbers (rows, columns, gap, background, label strip). Leave it on *none* and
  new offers simply start without collage numbers until you pick a template on the offer itself.
- **Single photos while the photo limit allows** — whether a new offer here photographs its
  single-stamp sets one per image while *Max photos* above has room, collaging only what is left
  over, or always collages them (see
  [single photos and the limit](offers.md#single-photos-and-the-limit)). On unless you say
  otherwise: the limit right above it is the very fact the rule reads, so a platform is where a
  collector who always wants collages says so once.
- **Group series on their own photos**, with the template beside it — whether a new offer here
  shows each series its set holds two or more stamps of on photos of its own, laid out with the
  chosen template (*same as the collage template* uses the one above). Off unless you tick it: a
  Facebook lot can then keep its singles on a 1×2 while its series get a larger grid. See
  [series in a lot](offers.md#series-in-a-lot).

These — plus the **photo tile labels** from the templates dialog — are **copied onto the offer**
when it is created, not looked up later. Changing them here therefore affects only offers you create
from now on; offers already prepared or listed keep exactly the photos they were set up with. Adjust
one of those on the offer itself, with the **⚙** button in its Photos card (see
