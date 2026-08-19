# ADR-0037: Reconciling listings from a Delcampe active-items export

## Status

Accepted

## Context

ADR-0036 built the Easy Uploader export (#610): a batch of `ready` offers leaves the app as one CSV
and the pictures it names, and `personal_reference` carries each offer's own number (#635). Nothing came
back. An exported offer stayed `ready` for ever, carried no listing URL, and therefore had none of
what a URL is the foundation of — the *Sold on platform* flag, listing drift (#542), and every link
from a record here to the listing it is up as.

Delcampe's REST API is behind the paid API Pass and is deliberately not used (ADR-0034), so there is
no sweep to run. What there is instead is a **CSV export of the seller's own active items**, and it
carries the reference back:

```
id_auction,title,personal_reference,description,id_category,shipping_model,weight,visits_number,end_date,GMT,present_price,quantity,bids_number,best_bidder
2508054797,"Saar, Mi:275, Yv:284, ** (MNH)",<ref>,,24678,"Fee template",,4,"2026-08-28 14:53:00","GMT +1.0",17.44,1,0,
```

`id_auction` is Delcampe's own listing id — the same kind of thing as `Offer.allegroOfferId` (#477),
matched on exactly rather than derived from an address — and the item's public address is composed
from it.

## Decision

### 1. The transition happens on confirmation from the platform, never at export time

`ready → active` is written **here**, by an import that found the listing in Delcampe's own file with
Delcampe's own id, and not by the export that produced the CSV. A downloaded file is not a listing:
Easy Uploader can refuse it, the collector can upload half of it, and an offer moved to `active` on
the strength of a download would read as live while nothing was ever posted.

The listing id lands on `Offer.delcampeItemId` and the URL is **composed** from it rather than stored
a second time. The id is what #612 will match an order's items on, and it is unique per collection:
two offers claiming one `id_auction` is a contradiction, not a state to reconcile later.

### 2. Absence is the signal, and the file's wholeness is what makes it trustworthy

A listing recorded as up by an earlier import and missing from the current one has come down. This is
#467's rule and it is cleaner here: an Allegro sweep is paged, so a half-finished one would report
everything it had not yet reached as ended — hence `AllegroSyncState.listingsSweptAt`, and the rule
that only a completed pass may derive anything. **A file has no pages.** Every listing the account has
up is in it, so nothing equivalent is needed and nothing equivalent is stored.

What that absence *means* — sold, ended, pulled — is deliberately not decided. The offer's state is
untouched; the listing row is marked `ENDED`, keeping the date it was last seen up, and the collector
is shown a row to act on. Recording the sale is #612's, from the order screens where the buyer and
the amount actually are, and inventing a sale from an absence is the one thing that would make this
feature dangerous rather than useful.

The rows are **never deleted**, unlike `AllegroListing`'s aged-out `ENDED` rows: an ended listing's id
is exactly what #612 will meet again on a *sold* order, months after the listing came down.

### 3. Two listings claiming one offer is a refusal, not a coin toss

Delcampe does not enforce uniqueness on `personal_reference` — the collector's own live listings
carry one reference on two different `id_auction` values. Exported references are unique by
construction, so a duplicate is a fault to go and fix, and both rows are refused: neither is applied,
the offer is left exactly as it was, and both are reported with the offer number they name.

A row that matched on its own `id_auction` (§4) is outside this count: it never asked the reference,
so a reference it happens to carry cannot make another row ambiguous.

The same rule covers an offer already up as a *different* listing that is **also** in this file: both
are live, and that is the same contradiction. Where the id the offer names is **absent** from the
file, that listing has come down and this one is its replacement — a relist, which is the ordinary
way a Delcampe listing is put back up by hand, and taking it over is the only reading that is not a
guess.

### 4. The listing id leads, and the reference answers only for first contact

**Amended by #635.** This section originally read `personal_reference` as an *address*: the path
decided which offer, the collection slug in it had to be this collection's, and the origin was
deliberately not compared. Delcampe caps the column at 20 characters, so the address is gone
(ADR-0036 §2) and it now carries the offer number alone.

That makes the **order** of the two matches the decision rather than the spelling of one of them. A
row whose `id_auction` an offer already carries *is* that offer's listing — the id is globally
unique, Delcampe issued it, and this app wrote it down from a previous import of this same file — so
the reference is not read at all, including a reference that names some other offer. Only a listing
this collection is seeing for the **first time** falls through to the number, which is the one moment
there is nothing else to go on. Every import after it matches on something nobody can duplicate by
accident.

The reference is also read strictly: digits and nothing else. A listing put up before this feature
existed carries whatever the collector typed — a storage `ref`, a note — and reading a number out of
the middle of one would claim a listing nobody pointed at that offer.

What is given up is the slug check. A bare number cannot say which collection it belongs to, so two
Stamporama collections served by **one** Delcampe account could claim each other's new listings; the
import is already scoped to the collection the collector picked, and `id_auction` leading confines
even that to first contact. Stated as a limit rather than engineered against.

### 5. What the file says about money reaches an offer only where the offer is an auction

`present_price`, `bids_number` and `end_date` are recorded on every listing row, matched or not — an
unmatched auction still has a standing bid. They reach the **offer** under #481's rule, narrowed by
what this file does not say:

- **The file states no selling format**, so the local `listingType` is the whole test. Allegro's
  `bidWriteFor` requires both sides to call it an auction; here only one side speaks, and an offer
  recorded as fixed-price is left alone. Correcting a mis-recorded listing type is a different claim.
- **The file states no currency** — it is an account-level setting on Delcampe — so the platform
  contact's own currency (#196) stands in, and a figure is written only where the two agree.
- A **fixed-price** listing's `present_price` is never written back. It is the collector's own asking
  price coming home again, and a file that disagrees with it is listing drift (#542): a thing to show,
  not to resolve by letting the marketplace's copy win.
- `bids_number` counts **bids** where `Offer.bidderCount` counts people. The file does not carry the
  number the column is named for; what is stored is what was said, which answers the only two
  questions it is read for, and the distinction is stated rather than papered over.

### 6. The two directions of the contract are not symmetric, and neither module knows the other

The upload file writes a decimal with a **comma** (`"0,10"`) and states no time zone at all
(ADR-0034 §5). The export returns a decimal with a **dot** (`17.44`) and carries its zone in a
**separate `GMT` column**. `delcampe-export-rules.ts` owns the writing and `delcampe-import-rules.ts`
the reading; a shared "Delcampe number" helper would have to be told which direction it was in on
every call.

The reader takes columns **by name**, so a reordered or extended export still reads, and refuses a
file with no `id_auction` / `personal_reference` header by naming them — the likeliest wrong pick is
the *sold*-items export, which is a different file for a different job (#612).

### 7. Where it is read

A screen of its own, `offers/delcampe` (*On Delcampe*), beside *Sold on Allegro* under the Offers
group. What is up and matched is a **count in the header**, not a list: those listings need nothing
from anybody and the offers list already shows them with their addresses. What is on the screen is
the two things an import leaves behind that somebody has to act on — what has **come down** while the
offer here is still open, and what matched **no offer**. The header states when the last export was
read and which file it was, for the Allegro worklist's reason: a reconciliation is only ever as true
as the file it was done from.

The offer's own **On Delcampe** card states the same listing from the same row, which is this
codebase's rule for every flag a list shows.

## Consequences

- A collector's loop closes: export a batch, upload it, download the active items, import it — and
  the batch is `active` with addresses that link back to the listings.
- The app can now tell that a listing is no longer up without asking Delcampe anything, at the cost of
  the collector downloading a file when they want to know.
- Nothing about a sale is inferred. Until #612, "came down" is a row on a screen and the collector
  records the sale through the ordinary sell flow.
- `DelcampeListing` grows by one row per listing ever seen and is not pruned. The rows are small and
  are the only record that a listing existed at all.
- The import is synchronous and bounded (5 000 rows); an account larger than that would need a
  different shape, which is a problem worth having.
