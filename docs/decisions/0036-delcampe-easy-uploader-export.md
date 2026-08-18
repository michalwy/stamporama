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

### 2. `personal_reference` carries the offer's own URL

Decided in #154 and recorded here because the export is what writes it. A bare `offerNo` is a
per-collection sequence starting at 1, so offer 42 exists in *every* instance and the reference would
resolve confidently to the wrong one; `collectionSlug/offerNo` does not fix it either, since a dev
instance is normally a dump of production and **every** value taken from inside the database is
identical in both. The origin is the only discriminator a database dump does not carry.

The cost is accepted: moving the instance to another domain leaves stale addresses in live listings.
That failure is visible and harmless, while ambiguity is silent and wrong. It is safe because
`personal_reference` is seller-visible only, confirmed on the platform, and it is what makes #611's
reconciliation exact. An instance with no `BETTER_AUTH_URL` refuses the export outright rather than
writing rows nothing could match back.

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
- `personal_reference` round-trips, so #611 can match a returning active-items export back to offers
  exactly rather than by URL.
- The bundle is buffered in memory and capped at 100 offers, the rail the batch photo archive already
  carries; past it the answer is to narrow the session with the area or year filter.
- Two numbers in the file remain observations rather than facts — the bid-step threshold and the
  title cap — and both are corrected by typing, not by a release.
