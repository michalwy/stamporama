# ADR-0071: Platforms Are Their Own Entity — Five Module Platforms and the Collector's Generic Ones

## Status

Accepted. Decided with the collector in #1944 on 2026-10-16 and built by #1955. **Supersedes the
platform-as-contact parts** of ADR-0008 (the `platform` role and the platform settings on `Contact`)
and of every later ADR that names a platform contact — ADR-0009, ADR-0012, ADR-0015, ADR-0021,
ADR-0023, ADR-0025, ADR-0026, ADR-0034, ADR-0061, ADR-0063, ADR-0064 and ADR-0066, each of which says
so in its own status. What those ADRs decide about a platform still holds; only *where the platform
is* changed. #1956–#1959 trim each module page's Platform tab to what its platform uses, and #1960
brings a platform's figures back on a page of its own.

## Context

A marketplace was a `Contact` carrying the Platform role (ADR-0008), and its settings were split: the
contact form's Platform tab carried the currency, the templates, the limits and the photo defaults,
while the Allegro, Delcampe, Facebook, Colnect and Philasearch pages in Settings each chose which
contact *was* that marketplace (`Contact.platformModule`). The address book mixed people with
marketplaces, a contact form grew a tab no person needed, and the one fact "which platform is
Allegro" was a choice that could be left unmade or made twice over the life of a collection.

## Decision

### 1. A platform is a record of its own

`Platform` is collection-scoped like every other model: a name, notes, an on/off switch, a market,
and every setting the contact form's Platform tab carried — the currency (#196), the listing
language, the templates, the text and photo limits, the photo defaults, the listing type and
starting price, the minimum price, the refresh threshold, the buyer's message, the default Allegro
and Delcampe profiles. The columns kept their contact-era names (`platformCurrency`,
`platformModule`), so every read that followed an offer's or a sale's `platform` relation needed no
change. The address book holds only people and firms: no contact carries a Platform role.

### 2. Two kinds: five module platforms, any number of generic ones

- **Module platforms** — Allegro, Delcampe, Facebook, Colnect and Philasearch — exist **exactly once
  each per collection** (`UNIQUE (collectionId, platformModule)`), are made with the collection, carry
  **their module's fixed name**, and are configured on their module's own Settings page. Philasearch
  is the fifth: the collector decided so on 2026-10-16, since a lot captured from it needs a platform
  to land on exactly as an Allegro one does.
- **Generic platforms** — eBay, a forum, a club's list — are added, renamed and deleted under
  Settings → Selling → Platforms.

Names are unique within the collection, a generic one included against the five module names
(ignoring case). *Rejected:* only the module platforms being platforms; every platform added by hand
with a type chosen, which would have allowed two Allegro accounts; one Settings entry listing the
module platforms too; an entry per generic platform.

### 3. Every platform has an on/off switch

A platform switched off is offered in **no platform picker for a new record** — the offer, sale,
purchase, auction and price-observation forms, the quick-offer bar, the lot builder — and every record
that already names it keeps showing it. A module platform starts switched off and is switched on on
its own page; until it is, its module answers as an unchosen platform did (`getModulePlatform` is
null), which every caller already handled as *not set up*. Generic platforms have the switch too, so
one no longer used leaves the pickers without its history being deleted. Delete is refused while any
offer, sale, purchase, auction or price observation names a platform, as a contact's was; a module
platform cannot be deleted at all.

A typed platform name still resolves on save (#120's create-on-type): an existing platform of that
name, any case, a module one included; failing that, a new generic platform.

### 4. Counterparty and venue stay apart

The seller, buyer or auction house of a record stays a **contact**; the platform is **where it
happened**, as purchases, sales and auctions already recorded both (ADR-0009, ADR-0012, ADR-0021). A
house selling directly is now two records — a contact that sells and a platform of the same name. A
record with no platform (an auction house's own sale) stays without one.

### 5. Market and currency move to the platform, their rules unchanged

The platform carries its own `market`. The rule deciding which market a result counts in (#1634,
ADR-0064) is unchanged — the auction house's market, else the platform's — and a contact keeps its
own `market` for the house half of it. The currency lock on offers and sales (#196) is unchanged and
reads the platform's `platformCurrency`.

### 6. The data moved once, every id kept

`20261016130000_platform_entity` did the move at once, not platform by platform, since a record
cannot name a contact on one platform and a platform on another:

- a contact became a platform when it carried the role, held a module marker, or was named as a
  platform by anything — so a record whose platform's role had been unticked still finds it;
- **each platform kept its contact's id**, so every `platformId` in the database names the same thing
  before and after and only its foreign key moved;
- the contact a module page had chosen became that module platform under the module's name; every
  other one a generic platform of its own name — or, where that name is a module's, with ` (2)` after
  it; `enabled` follows the old role;
- a module with no contact got its platform switched off;
- the former platform contact went, unless it carried another role, was the counterparty on some
  record (a purchase's supplier, a sale's buyer, an auction's seller, an observation's house, a
  trade's partner), or had an address-book field filled (full name, email, phone, Facebook profile)
  — then it stays as an ordinary contact. Its notes were copied to the platform.

### 7. The agent API keeps its shapes

Wherever an operation took or returned a platform contact it now takes or returns a platform,
**named the way the platform contact was named** — by the same id, and by name through the
vocabulary's `platforms`. The vocabulary lists every platform, switched-off ones included (a read
must be able to filter by one), marking those with `enabled: false`; the key is absent on a platform
that is on. Contact operations know no Platform role. Under ADR-0050's rule that `/api/v1` only grows,
an added optional key is not a new version.

## Consequences

- The contact form, the contacts list and the contact page show nothing of a platform; the contact
  page's Platform section went, and #1960 put its figures on the platform's own page, as the second
  row of its summary strip (ADR-0059 §4).
- Each module page gained a **Platform** tab carrying the whole set of a platform's settings; #1956,
  #1957, #1958 and #1959 trim each to what its platform uses.
- A new collection is created with its five module platforms; a collection that somehow lacks one
  gets it the first time Settings opens (`ensureModulePlatforms`). The Facebook platform starts
  needing covers on its photos, which used to happen when a contact was first named as Facebook
  (ADR-0066).
