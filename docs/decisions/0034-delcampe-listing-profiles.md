# ADR-0034: Delcampe Listing Profiles

## Status

Accepted

## Context

Delcampe is a selling platform for this collection (#608, part of #154). Preparing a listing for it
is already most of the way there: the title and description come from the platform contact's
templates (#210, #266), the price and quantity from the offer, the currency from `platformCurrency`
(#196), the listing type from `Offer.listingType` (#449), the photos from the offer's photo plan.

What is missing is everything else an **Easy Uploader** row states. Delcampe has a REST API
(`POST /item`, `personal_reference` lookup, `GET /shippingModels`), but it sits behind the paid
**API Pass** subscription and is deliberately not the path taken: listings are created by uploading
a CSV, and the file's columns are the contract.

```
category_id,title,personal_reference,description,selling_type,price,minimum_bid_step,initial_quantity,
images,renew_duration,renew_total_count,sale_end_time,sale_end_day,shipping_model,weight,
option_strong_title,option_background_color,option_border_color,option_list_promotion,
option_homepage_promotion,has_renewable_options
```

Four groups of columns have nowhere to live in this app:

- `shipping_model` — the name of one of the shipping models the seller has defined on Delcampe. A
  pick list, not a constant: one has been used so far, and heavier lots are expected to need another.
- `renew_duration` / `renew_total_count` / `has_renewable_options` — 28 × 99 × N, shop-stock renewal.
- The five `option_*` promotion flags, all `N` today and each of them chargeable.
- `minimum_bid_step` — observed at `0,01` on cheap items and `0,10` on dearer ones, so a **rule**
  rather than a value, whose threshold nobody has confirmed.

The category is deliberately not in this list: it is a property of *these stamps* and is learned
rather than configured, which is #609's, exactly as #488 is Allegro's.

## Decision

### 1. One named profile per platform, carrying all four groups together

`DelcampeListingProfile` hangs off the platform `Contact` this collection calls Delcampe — the
ADR-0025 ownership, for its reasons. All four groups live in the *same* profile rather than in
separate dictionaries, because the case that makes a second answer necessary is one case: a heavier
lot wants the other shipping model, and it is chosen at the moment the row is built. A pick list of
shipping-model names beside a separate set of renewal defaults would be two lists to keep in step
for a single decision, and nothing has yet asked to vary one without the other.

`Contact.defaultDelcampeListingProfileId` is what an upload row is built with;
`Offer.delcampeListingProfileId` overrides it and is null on essentially every offer. Both are
`SetNull`, nothing is promoted when the default is deleted, and
`resolveDelcampeListingProfileForOffer` is the whole of the fallback rule — ADR-0025 §2 restated,
not re-decided.

### 2. The shipping model is an unvalidatable name, and the app says so

This is **inverted from Allegro** (ADR-0025 §3). There, the profile stores Allegro's own id with the
name as a screen label, so renaming a rate set on the marketplace breaks nothing. Here the CSV
carries the name itself, there is no id in reserve, and the list it would be checked against
(`GET /shippingModels`) is behind the API Pass this integration does not buy.

So the name is stored as data that cannot be checked, and the editor states plainly that it must
match Delcampe exactly and that a renamed model means a rejected upload. The point of saying it
there is that a refusal at upload time must not read as a fault in the export: nothing about the
file was wrong, and nothing here could have known.

### 3. `minimum_bid_step` is a stored threshold rule, not a constant

Three columns — `minBidStepThreshold`, `minBidStepBelow`, `minBidStepAtOrAbove` — with one pure
function over them (`delcampeMinimumBidStep`), and the boundary **inclusive at the top**: a listing
priced exactly at the threshold takes the larger step. Stated once so the export, the settings
preview and any later reader cannot each pick their own reading of "more expensive".

The threshold is a field rather than a constant precisely *because* it is unconfirmed. A guess
compiled into the exporter is a guess nobody can see or correct; a guess seeded into a settings
field is one the collector corrects the first time a listing disagrees with it. The seeded figures
are the observed ones: 0,01 below 1.00, 0,10 from there.

### 4. A marker with no Assistant module

`Contact.platformModule` gains `"delcampe"` — which platform *is* Delcampe, the one fact the
profiles, the learned categories (#609) and the export (#610) cannot work out for themselves — and
it is deliberately **not** registered in `LISTING_MODULE_RULES`. Delcampe is listed to by uploading
a file this app builds, not by an extension filling a form, so `hasListingModule` answers false: no
⚡ handoff is offered and none of Colnect's preconditions (a Colnect item-ID, a mapped grade) is
asked of a Delcampe offer. That is the same distinction #471 drew for Allegro's capture-only marker.

### 5. Nothing here formats a file

The two asymmetries of the contract — the upload writes decimals with a **comma** (`"0,10"`) while
the export file returns them with a **dot** (`17.44`) — belong to the writer and the reader (#610,
#611). This layer answers *what* a row says; how it is spelled is not its business, which is why
`delcampe-listing-profile-rules.ts` holds the bid-step rule and no formatting at all.

### 6. Auctions are out — *superseded by §7 (#620)*

`renew_duration` 28 × `renew_total_count` 99 is shop-stock behaviour and is wrong for a listing with
a real end. An auction needs a starting price, an end day and hour, and a second set of duration
defaults — #620, and a second profile field group at that point rather than a reinterpretation of
this one.

### 7. Auctions are a second field group, seeded with nothing (#620)

Taken as §6 said it would be: `auctionDuration` and `auctionRenewTotalCount` supply an auction row's
`renew_duration` and `renew_total_count`, and `auctionEndDay` / `auctionEndTime` supply the two end
cells that are empty on every quick buy. The exporter picks the group by the offer's own listing type
(#449); nothing here reinterprets the shop-stock counters, and nothing falls back to them — a row
that borrowed 28 × 99 would renew itself past the deadline that was the auction's whole point.

Three decisions inside it are worth stating, because each was available in an easier form:

**The end cells are verbatim text, not a day picker.** What spelling Easy Uploader wants for a
closing day and hour is published nowhere this app can read and has never been confirmed. This is §2's
situation exactly — an unvalidatable cell the file carries by value — so it takes §2's answer: store
what the collector types, write it unchanged, and say in the editor that it cannot be checked. A
picker would be a *claim* about the format, and a wrong claim would need a release to correct, while
a wrong text cell is corrected by retyping it. Blank is allowed and means the row states no end,
which is a listing rather than a fault.

**The duration group is seeded with nothing at all**, which is the one place this model departs from
§3's "seed the guess into a settings field". §3's figures were seeded because they were *observed* —
0,01 and 0,10 on the collector's own live listings. There are no auctions to observe, so a default
here would not be a correctable guess but this app inventing how long somebody's auctions run, and
inventing it invisibly: a plausible 7 × 1 uploads without anyone reading it, while a blank one is
refused at export, named on the offer's card and read back in Settings. `delcampeAuctionGaps` is that
refusal, and it is one function so the editor's sentence and the export's refusal cannot disagree
about whether a profile is ready for auctions.

**`price` carries the starting price**, which is #477's rule transferred verbatim. On Allegro it
lived in `sellingMode`; here `Offer.price` holds the asking price of a quick buy and the *standing
bid* of an auction (#449), so listing from it would state an opening figure nobody offered. The row
states `startingPrice` or it is refused — never the column beside it — and `minimum_bid_step` is
computed against the same figure, so the step a row states is the step for the listing it opens.

## Consequences

- An auction offer exports as an auction, and one that cannot is refused by name before a file
  exists — the same all-or-nothing rule every other row is held to (ADR-0036 §3).
- The collector states how long their auctions run once, in Settings, and every auction row after
  that carries it. Nothing about a fixed-price listing changes: the shop-stock group still answers
  for it, and a profile that never uploads an auction is still saved with its auction group blank.
- #611 needs no change to reflect the bidding back; it simply stops reading zeroes.
- #610 has one thing to ask for and one place it comes from, and every column of the upload file is
  answerable before a line of the exporter is written.
- The collector confirms the bid-step threshold by typing it into Settings rather than by reading
  code, and a listing that disagrees with it is a one-field correction.
- A rejected upload caused by a renamed shipping model is a known, stated failure mode rather than a
  bug report against the export.
- Nothing about marking a platform as Delcampe changes what its offers are checked for: the marker
  carries no listing module, so the Colnect-shaped preconditions stay off.
