# ADR-0036: The Delcampe Easy Uploader export

## Status

Accepted

## Context

Delcampe listings are created by uploading a file through **Easy Uploader** (#610, part of #154).
The API path was rejected on cost in ADR-0034, so the file *is* the listing: the CSV's columns are
the contract, and every one of them is now answerable — the title and description from the
platform's templates (#210/#266), the price, quantity and `selling_type` from the offer (#449), the
currency from `platformCurrency` (#196), the four "way of selling" groups from the offer's resolved
listing profile (ADR-0034), the category from the learned register (ADR-0035), and the pictures from
the offer's photo plan (#313/#314/#326).

What was missing is a **manifest that agrees with an archive**, not a new way of collecting
anything. The bulk listing workspace (#322) is already scoped to one platform and to `ready` offers,
which is exactly the shape of one Easy Uploader batch, and `POST …/offers/photos/zip` already builds
that batch's pictures from the same plan (#323).

## Decision

### 1. One flat ZIP: the CSV and the pictures it names

The bundle is a single archive holding `delcampe-upload.csv` at the root beside every picture, with
no folders. The CSV's `images` column names its pictures **by file name and nothing else**, so a
folder per offer — which is what the batch photo archive has (#323) — would leave the column naming
files Easy Uploader cannot find.

The names are the photo plan's own (`<offer>-01.jpg`, #326), never invented here, so a picture in
this bundle is byte-identical to and named exactly as the same picture downloaded from the offer on
its own. The single case flat cannot cover — two offers whose titles slug the same — is suffixed
**per offer**, not per file, so one listing's pictures stay a run of one stem.

### 2. `personal_reference` carries the offer's own number

**Amended by #635, on first real use.** This section originally decided the offer's *absolute short
URL*, and Delcampe refused it: the column is capped at **20 characters**, no URL fits inside one, and
Easy Uploader rejects the whole file. It now carries `Offer.offerNo` as a bare number.

The original reasoning is kept because #635 had to answer it rather than ignore it. A bare `offerNo`
is a per-collection sequence starting at 1, so offer 42 exists in *every* instance;
`collectionSlug/offerNo` does not fix that either, since a development instance is normally a dump of
production and **every** value taken from inside the database is identical in both. The origin was
the only discriminator a database dump does not carry.

What answered it is #611, not a shorter spelling of the same address. The reference has two jobs, and
each now has a better source than this column:

- **Matching a returning batch back to offers (#611).** The file is imported *into* a collection the
  collector chose, so the instance and the collection are known by construction.
- **Telling the extension which offer a Delcampe row is (#612).** After the first reconciliation the
  offer carries its `id_auction`, which is globally unique and printed on the page — #466's split
  exactly: the page states which listing it is, the instance states whether it is ours.

So the reconciliation matches on `id_auction` **first** and consults the reference only for a listing
seen for the first time (ADR-0037 §4). The reference's whole exposure is that first contact, and a
few digits against a 20-character cap is headroom that cannot be exhausted.

Two things follow. The export stops needing to know the instance's own address at all, so
`BETTER_AUTH_URL` leaves this path and a refusal a collector could not act on goes with it. And the
column becomes readable again in Delcampe's own seller UI, which is what the collector had before
this feature existed, when they typed a storage `ref` into it by hand.

What is given up is the slug check the path carried: a bare number cannot say which collection it
belongs to. The import is already scoped to the collection the collector picked, so a wrong match now
requires **one Delcampe account serving two Stamporama collections**, and only on a listing's first
contact. That is a limit worth stating rather than engineering against speculatively.

### 3. A refusal is the whole batch, and it is a refusal rather than a repair

An offer that cannot be written as a row — no category, no photos, no profile, no price, a title
over the platform's cap, an auction — refuses the **export**, not just its own row, and every reason
for every offer is reported at once.

This is deliberately the opposite of the bulk photo archive, which skips an offer with nothing to
upload (#323). A missing folder in a download is visible and costs nothing; a missing *row* is not:
the file goes up once, and the offer it left out stays `ready` looking exactly like one waiting for
the next batch, so the listing that never happened is discovered whenever somebody next counts.
Every `ready` offer is one the collector has said is ready to list, so one that cannot be written is
a fault to fix rather than a row to drop.

Nothing is trimmed to fit — #405's rule for Colnect's texts and #477's for Allegro's titles, arriving
where it matters most: a title silently shortened is a listing nobody proofread.

### 4. The title cap is a platform setting

`Contact.maxTitleLength` joins the two caps #403 already holds, blank until somebody fills it in.
Delcampe does not publish the figure anywhere this app can read, so whatever it held would be an
observation — and an observation kept in a settings field is corrected the first time a listing
disagrees with it, where one compiled into the exporter is not. It is ADR-0034 §3's reasoning about
`minBidStepThreshold`, applied to the one other unconfirmed number in the file.

It is a **platform** cap rather than a Delcampe one: it is the same kind of fact as the description
cap, it is read live by every surface that shows a title, and a platform that states no cap costs no
UI at all.

### 5. The ongoing-sales ceiling is not checked

#610 proposed refusing an export that would put the seller past Delcampe's ceiling on running sales.
It is not checked and not stored.

The ceiling follows the subscription package, and this app cannot see the live count: listings are
created from files uploaded by hand, ended by buyers, and relisted by Delcampe itself. Anything
counted here would be *this app's offers*, not the seller's sales — a figure that would block a
legitimate batch as confidently as it let an over-full one through, while reading like a real
guarantee. Staying inside the package is the collector's, and the user guide says so.

### 6. Fixed price only

`selling_type` is written `fixed_price` and an auction offer is refused. An auction wants a real end
date and a second set of renewal defaults (ADR-0034 §6), which is #620's — writing one out as a quick
buy would be the export deciding how something sells.

## Consequences

- A prepared batch leaves the workspace as one file plus its pictures, and Easy Uploader takes it
  without hand-editing.
- What the file cannot state is stated *before* it exists, one line per offer, each naming the screen
  it is fixed on.
- `personal_reference` round-trips inside Delcampe's 20-character cap, so #611 can match a returning
  active-items export back to offers — on `id_auction` where it can, on the offer number where the
  listing is new.
- The bundle is buffered in memory and capped at 100 offers, the rail the batch photo archive already
  carries; past it the answer is to narrow the session with the area or year filter.
- Two numbers in the file remain observations rather than facts — the bid-step threshold and the
  title cap — and both are corrected by typing, not by a release.
