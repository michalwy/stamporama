# ADR-0025: Allegro Listing Profiles

## Status

Accepted

## Context

ADR-0023 established the connection and ADR-0024 the reads built on it. Publishing (#477) is the
first **write** to Allegro, and `POST /sale/product-offers` demands a great deal that no `Offer` in
this app has any notion of:

- `delivery.shippingRates.id` and `delivery.handlingTime` — a **shipping rate set** defined on the
  Allegro account (`GET /sale/shipping-rates`). Not our `ShippingMethod` (#468), which is a name and
  a cost recorded when a sale is made: that one describes what the buyer paid, this one is Allegro's
  own table of what a listing *offers*.
- `afterSalesServices` — a return policy and an implied warranty, from the account's dictionaries
  (`GET /after-sales-service-conditions/*`). Allegro defaults these only for business accounts, so a
  private collector's account has to name them.
- `location` — country, city, post code. Nowhere in the model at all.
- `payments.invoice`.

Every one of those is the collector's **account configuration** rather than anything about a stamp.
It is identical for a 1918 Polish issue and a modern block, and it changes when the collector moves
house or adds a courier — never when they list something else. Putting it on the offer would mean
re-answering it on every listing, and putting it in the environment would mean a self-hosted install
where changing your post code is a container restart.

The category and its parameters look superficially similar and are deliberately **not** here. Those
*are* about the stamp, they differ per listing, and they are learned from what was published before
rather than configured. #488 owns both.

## Decision

### 1. A named profile, owned by the Allegro platform contact

`AllegroListingProfile` hangs off the platform `Contact` this collection calls Allegro — the same
ownership as its shipping-method price list (#468), for the same reason: the settings are a
marketplace's, and a `Contact` is how this app names a marketplace. `collectionId` rides along for
scoping, as every other per-parent dictionary carries it.

It is **named** rather than being a single set of fields on the contact because the plural case is
real and cheap: "Home, letter rates" and "Away, courier" are one collector's two answers, and a
model that admits only one forces the second to be a manual edit before and after every posting run.

### 2. A default per platform, and a nullable reference on the offer

`Contact.defaultAllegroListingProfileId` is what a listing is published with; `Offer.
allegroListingProfileId` overrides it and is null on essentially every offer. This is the
`defaultCollageTemplateId` shape (#308): a default is **one row of the list**, not a flag on every
row that something has to keep exclusive, so there is no moment at which two profiles both claim it.

Both references are `SetNull`. Deleting a profile must never be blocked by a listing that merely
preferred it, and "falls back to the platform's default" is a defined state rather than a gap.
Nothing is promoted when the default itself is deleted: choosing which settings the next listing
goes out with is the collector's decision, and a silently inherited default is the one way this could
publish something unmeant.

One resolver — `resolveAllegroListingProfileForOffer` — is the whole of the fallback rule, so the
settings screen and the publish path cannot come to disagree about which settings a listing carries.

### 3. Dictionary references are Allegro's ids, validated at publish time and not on save

The three dictionary fields store **Allegro's own ids**, naming things that exist only in the
collector's Allegro account and cannot be created from here. Beside each id is a `*Name` **snapshot**
written from what the account said when the profile was saved: the id is the truth, the name is a
label a screen can show without a live call — including when Allegro cannot be reached at all.

A save does **not** re-validate against the account. A rate set can be deleted on Allegro at any
moment, so the question has exactly one honest answer time — when the listing actually goes out —
and asking it on save would trade a settings screen that always works for a check that proves nothing
about then. What the editor does instead is read the account **live** every time it is opened, and
again on demand: a rate set added five minutes ago is selectable, a list this app remembered would be
wrong the first time anything changed there. #477 is where a missing rate set becomes a refusal.

### 4. Vocabularies are code, not database enums

Handling times (`PT0S`, `PT24H`, `P3D`…) and invoice types are Allegro's vocabularies, held in the
pure `src/lib/allegro-listing-profile-vocabulary.ts` and validated there. A value Allegro adds is a
one-line change rather than a migration, and the module is `server-only`-free so the settings editor
— a client component — builds its selects from the same list the domain layer validates against.

Handling time is stored as Allegro's ISO-8601 duration rather than a number of days: `PT0S` and
`PT24H` are not days, and re-deriving the marketplace's wording from an integer is a translation
with nothing to gain.

### 5. An account with none of something says so

An account that has defined no return policies is an ordinary private account, not a failure. Empty
dictionaries render as an explanation pointing at Allegro — none of these can be created from here —
and the return policy and implied warranty are nullable, so a profile that cannot name one is still a
profile worth having. Whether such a listing may go out is #477's rule, not this one's.

## Consequences

- Publishing (#477) has one thing to ask for and one place it comes from, and it is the only code
  that has to know what a missing rate set means.
- A collector who moves house edits one profile rather than every prepared listing.
- The per-offer column exists before anything sets it: the offer-side control belongs with the screen
  that publishes, and adding the column later would have meant a migration to say something the model
  already knew it wanted.
- Nothing here reaches into a listing already published — Allegro holds those values from the moment
  they went out, and editing a profile is explicitly not a way to change a live listing.
