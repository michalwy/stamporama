# ADR-0035: Delcampe Categories Are Learned Too, From One Platform-Generic Register

## Status

Accepted

## Context

ADR-0034 took everything an Easy Uploader row needs that is a property of the *account* — the
shipping model, the renewal counters, the promotions, the bid step. What is left is the column that
is a property of the *stamps*: `category_id`.

It cannot be defaulted and it cannot be dictionaried. The collector had been keeping exactly such a
dictionary in a spreadsheet, and it is the wrong shape for two reasons:

- Delcampe's categories **do not line up with this collection's areas**. They are broader, and are
  cut by period ranges this collection does not use — `Stamps > Europe > Poland > 1944-…. Republic >
  1944-60 > Used stamps`.
- The category also depends on facts Stamporama does not reliably hold. `Mi:Block 34` is a souvenir
  sheet and Delcampe files it under `7911`, while the same country and condition as a single stamp
  goes to `7938`, and nothing here records "this is a souvenir sheet" dependably enough to key on.

A lookup table can only answer when the key contains everything that decides the answer. It does not.

What *does* work is what already works next door. ADR-0026 established a register that watches which
category an offer was actually listed in, keyed on the four facts the collection genuinely knows —
area, year, condition, subtype — relaxing rather than failing, correctable per offer and in settings.
Observed evidence says the same four facts participate on Delcampe: `7945` and `7946` are the same
country and condition in two periods, `7936` and `7938` the same country in two conditions.

## Decision

### 1. One register, generalised — not a Delcampe twin

`AllegroCategoryLesson` becomes `PlatformCategoryLesson`. It was never Allegro-specific: it has been
keyed per (collection, `platformId`) since ADR-0026 §5, and the Allegro name was the only Allegro
thing about it. The key, the relaxation ladder and the ranking are decisions about *this collection's
stamps*, so they relax the same way whichever marketplace is being asked, and two copies of that
ladder would drift on the first correction made to either.

This is cheap **precisely because ADR-0026 §1 kept two registers rather than one**.
`AllegroCategoryParameterMemory` stays exactly where it is and stays Allegro's: Delcampe's categories
carry no parameters at all, so there is nothing there for a second marketplace to share.

The split is carried into the code as well, not only into the table:
`platform-category-rules.ts` (pure: the key, the ladder, the matching, the "Learned from …"
sentence) and `platform-category.ts` (the reads and writes), with `allegro-category-rules.ts` and
`allegro-category.ts` reduced to what Allegro genuinely adds — its parameters, and its own
`matching-categories` guess from a listing title.

**The key is unchanged.** No axis was added for Delcampe, and in particular none for the
souvenir-sheet case: adding a "form" axis would mean this app claiming to know something it does not
record, and it would change Allegro's behaviour, which this must not.

### 2. Two suggestion sources, not three

Allegro's lookup falls through to `GET /sale/matching-categories`, which guesses a category from a
listing title. Delcampe has no such endpoint — it has no usable API here at all — so an unmatched key
falls through to the **picker**, which is a person rather than a source. `delcampeCategorySource` is
therefore `learned | manual`, against Allegro's `learned | allegro | manual`.

A picker is not a failure. It is the first offer of a kind, and the register is what makes it the
only one.

### 3. The category lives on the offer, and learns at `preparing → ready`

ADR-0026 §4 said "on a successful publish"; #494 already moved that to the transition to `ready`.
Here that reasoning is stronger, not weaker: a Delcampe listing goes up as a CSV uploaded days after
the offer was described, so a register that learned at publication would ask the same question twenty
times and answer it long after it stopped mattering. `ready` is where the collector has said what
these stamps are, which is the whole of what a lesson claims.

The category is stored on the `Offer` beside the Allegro one, with its `source` and the sentence it
was matched on, and is corrected on the offer's own **On Delcampe** card. That per-offer override is
not a nicety — it is what answers the souvenir-sheet case the key deliberately cannot.

**Nothing is a gate.** Whatever matched is what goes into the file.

### 4. Delcampe's own category list is snapshotted, and refreshed daily

A numeric id with no name is the spreadsheet again. Delcampe publishes the whole tree with ids at
`delcampe.net/en_GB/collectables/category-id/`, and its own help centre sends sellers there for
exactly this, so that is where the names come from.

`DelcampeCategory` holds it: id, name, full breadcrumb. It is **instance-wide, with no
`collectionId`** — the only table in this schema that is not collection-scoped — because Delcampe's
taxonomy is Delcampe's, identical for every collection on the instance, and a per-collection copy
would be N copies of one public fact refreshed N times. `StorageCacheEntry` (ADR-0011 §9) is the
existing precedent. It holds nothing of the collector's, so there is nothing to scope and nothing to
authorize.

It is a **dictionary, not a mapping**: nothing in it says what a stamp should be listed as. Losing it
costs names on a screen and nothing else, which is what makes a background refresh a safe thing to
have at all.

Refreshing is a walk of somebody else's site, and is treated as such:

- **Nothing at all** unless a collection on this instance has named a Delcampe platform.
- **Nothing** while the snapshot is under twenty hours old, so a restarting dev server never crawls.
- **Sequential and spaced** (~1.2 s), which is the pace the site does not refuse. Requests are not
  parallelised: this is data that changes a handful of times a year.
- A page that **expanded a heading's children in place** has already answered for that heading's own
  page, so the parser reports only the links it did not expand — the difference between roughly 260
  requests and roughly a thousand.
- A **429 ends the pass**. It is Delcampe saying *not now*, and the honest answer is to keep what was
  read and try again tomorrow.
- **Only a complete pass may delete.** A pass cut short has no opinion about the categories it never
  reached.

The parse is pure and unit-tested against saved markup, because the failure that matters — the list
stopped being readable — must be catchable in a test rather than only in a silently empty picker.

### 5. The picker is Delcampe's own tree, searched in place

Both halves earn their place, and the local snapshot is what makes having both cheap.

The **tree** is how a collector who knows where their stamps live gets there: `Europe → Poland →
1944-…. Republic → 1961-70` reads as the marketplace's own filing rather than as a list of eight
thousand strings, and it is the only rendering in which a *heading* is legible as a heading. The
**search** is how anyone else gets there, six levels being a long way to click — and it **narrows the
tree in place** rather than flattening it, so a result is still shown where it sits. A search expands
everything the narrowed tree still holds, since the matches are its leaves and a search that left
them folded away would have found nothing as far as the collector can see.

The tree is built from the **paths**, client-side, because the path *is* the parent link: Delcampe's
list states a breadcrumb per category and nothing else, and inventing an id for every heading in the
database would be storing something Delcampe never said. A node identified by its path is also the
only identification available — `Used stamps` names hundreds of nodes.

**A heading cannot be chosen.** `Stamps > Europe > Poland` is a place in the tree, not a category, so
it is shown, expandable, and refuses the click — `LocationTreeSelect`'s rule for a grouping-only
location, said in the same words. A node may be **both**: `Occupations` is listable and has children.

Search matches over the **whole path**, on word starts. `Used stamps` names hundreds of rows and only
the path says whose; and matching substrings would answer `used` with every *unused* category there
is, on a tree whose primary split is exactly that.

The whole list is loaded **once per picker**, not queried per keystroke: it is around seven thousand
short rows, a few tens of kilobytes compressed, it is public data with nothing of the collection's in
it, and having it in the browser is what lets expanding and searching agree with each other
instantly.

A **typed number is always accepted**, matched or not. Delcampe's list is the authority and this is a
snapshot of it: a category created since the last read must be usable the moment the collector reads
it off Delcampe's own selling form.

## Consequences

- Allegro behaves exactly as it did. The register it reads is the same rows under a new name, and
  its parameter half never moved.
- The second Delcampe offer of a kind carries no category work at all, and a correction on the offer
  is what teaches the register the collector's answer.
- Souvenir sheets are corrected per offer and stay corrected only for that offer — until one is
  prepared and the key that matched it learns the sheet's category, which would then be wrong for
  singles. That is a real edge the key cannot see; the settings panel is where it is put right, and
  the honest alternative — an axis for a fact this app does not record — would be worse.
- A category Delcampe retires stops arriving and stops being offered. An offer already prepared keeps
  the name it was given, that being a display snapshot (ADR-0025 §3), and the upload is where a
  retired id becomes a refusal.
- The catalogue read is the first thing in this app that fetches a marketplace page on a timer
  without an API contract. If Delcampe's markup changes, the parse tests fail and the picker falls
  back to typed numbers; nothing else breaks.
