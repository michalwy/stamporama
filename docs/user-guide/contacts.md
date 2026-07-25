# Contacts

**Contacts** are the address book of everyone you deal with as a collector — sellers,
buyers, exchange partners, auction houses, and the platforms you trade through (Allegro,
eBay, Delcampe). Contacts are scoped to a collection: each collection keeps its own list.

Open the **Contacts** screen from the **Trading** section of the sidebar.

## Roles

A contact can carry any combination of **roles**, or none at all:

- **Seller** / **Buyer** — someone you buy from or sell to.
- **Exchange partner** — someone you swap stamps with.
- **Auction house** — e.g. Cherrystone, David Feldman.
- **Platform** — an online marketplace a purchase, offer, or sale is routed through.
- **Other** — anyone who doesn't fit the above.

Roles are just labels: they show as badges on each row and let you filter the list. A
contact created automatically while recording a purchase starts with no roles — open it
and tick the ones that apply.

## Adding and editing

Click **Add contact** and fill in the **name** (required), optional **email**, **phone**,
**notes**, and the **roles**. Names must be unique within the collection.

Ticking **Platform** reveals a **Platform currency** field. This is the one currency every
[offer](offers.md) and [sale](sales.md) on that platform uses — it is inherited and locked there,
so an offer and its sale can never disagree. You can set it here, or leave it unset and pick it
inline the first time you list or sell on the platform. Changing it later leaves existing offers
and sales untouched — each keeps the currency it was created with.

Ticking **Platform** also reveals a **Listing language** — the language this platform's listings are
written in. Pick the one it uses; platforms that write in your collection's
[default language](collections.md#default-language) need nothing further, and neither does leaving it
on **— default language —**. The language does two things: generated titles for this platform use the
text you entered for that language, and the languages that *differ* from your default are the ones the
entity forms offer translation fields for. Nothing is translated automatically — where you have not
entered text for a language, the default text is used, so a title is never left with a gap. Today only
the area **title name** is translatable; conditions, issues and stamp names follow later.

Ticking **Platform** also reveals a **Listing title template** — a free-text template that decides how
[offer](offers.md) and set titles are pre-filled for this platform. Click **Edit template…** to open
the **template builder**, where you write it with **tokens** in curly braces mixed with any literal
text you like, for example `{catalog} {name} {year} {condition}`. Click a token chip to drop it in at
the cursor. The builder shows a **live preview** of the resulting title rendered against a real
inventory copy — **🎲 Random** shuffles to another copy, and **Pick copy…** lets you preview on a
specific one you search out. The preview also renders in the platform's **listing language**, so you
see the title as its listings will read. The tokens fill in from the copies in the offer (or set):

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
- `{issueName}` — name of the issue the stamp belongs to
- `{issueYear}` — year of that issue (also collapses to a range across copies)

Literal text between tokens — spaces, `-`, `/` — is kept as written; it only disappears when it was
gluing on a token that turned out empty. Use `{a|b|c}` to show the **first non-empty** of several
tokens: for example `{issueName|name|catalog}` prefers the issue name, falls back to the stamp name,
then the catalog number.

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
`1294CKB`, `1295CKB`, `1296KB` reads `1294-1295CKB,1296KB`. Each catalog is evaluated on its own, so
one catalog's mixed numbering never stops the others from collapsing.

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
with everything else you changed there. The same dialog will handle conditions, issues and stamp names
as those become translatable.

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

Every contact row has a **⋮** menu with **Edit** and **Delete**. Editing replaces all the
details and roles with whatever the dialog shows when you save.

## Finding a contact

Use the **search box** to filter by name, and the **role chips** to show only contacts of
a given role. The two combine — e.g. search "Jan" with the **Seller** chip active shows
only sellers whose name contains "Jan".

## Deleting

A contact can only be deleted once nothing references it. If it is still used by one or
more **purchases** (as the supplier or the platform), the **Delete** action is disabled
and the row shows how many purchases use it — detach it from those
[purchases](purchases.md) first. This keeps purchase history from losing who it was with.
