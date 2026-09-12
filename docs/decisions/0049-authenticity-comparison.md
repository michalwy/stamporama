# ADR-0049: Authenticity Work — A Forgery Is a Stamp, and the Verdict Is an Identification

## Status

Accepted, not yet implemented. Designed 2026-09-08 with the collector, in a design session.

**§6 is in** (#1006): `ScanTile.frontTurn` / `backTurn`, a side re-cut turned from the retained scan
(the stored crop turned once the scan is swept), the viewer mapping its turned picture back onto the
box through `src/lib/tile-turn.ts`, and an uploaded photo's turn written to its bytes on Save.

The work is tracked in #1000 (the seeded `Forgery` subtype and its migration), #1001
(`Photo.sourceUrl`), #1002 (the subtype filter on the copies list), #1003 (a picture in the
identify-variant dialog), #1004 (the two-photo comparison view), #1005 (reaching the references from
both identification surfaces), #1006 (quarter-turning a sideways photo, per tile) and #1007 (keeping
a forgery out of Colnect and the want list, which this ADR leaves **open** — see below).

It rests on ADR-0010 (subtypes and `actsAsVariant`), ADR-0033 §6 (the scan viewport), #137 (photos on
a stamp) and #585/#598/#614/#625 (the identification viewer and its measuring tools), and it adds
**one dictionary row and one nullable column** to the schema.

## Context

The collector asked for help deciding whether a stamp is genuine:

> "Nowa rzecz — wsparcie przy określaniu autentyczności znaczków. Do znaczka / issue chciałbym móc
> dodawać zdjęcia zarówno znaczków o potwierdzonej autentyczności jak i takich, które wiadomo że są
> falsami. Potem chciałbym móc ich użyć do porównywania zdjęć moich. Potrzebne będą pewnie jakieś
> narzędzia typu przeskalowanie, obracanie, nakładanie jednego na drugi z transparentnością,
> przesuwanie kurtyną między jednym a drugim…"

Two things were settled before the session and are not reopened here. **A reference belongs to a
stamp, never to an issue** — *"każdy znaczek się osobno rozpatruje"*. And the feature is **a working
surface and a record at once**: a comparison is looked at, and it leaves a conclusion behind.

### What the tree already had, and what it could not reach

The measuring stack is built and closed: the ruler and perforation gauge (#598), the automatic tooth
count (#614), the watermark filter (#625), and #740, which already compares a measured perforation
and watermark against the candidate variants. So the perforation gauge that looks like the obvious
first thing to build **is not missing** — it exists and it already narrows a candidate list.

All of it stands on one thing this feature cannot supply. `src/lib/scan-measure.ts` opens with *"The
scale is stated, never inferred"*: every figure is computed from a `ScanSheet`'s **stated** dpi, and
a scan's own metadata is deliberately not consulted, because #574's corpus carried EXIF that
disagreed with the pixels.

The collector's reference material has no dpi at all:

> "Prawie zawsze C [zrzuty z aukcji, Colnectu, forów], przy czym w C zawiera się też D (zdjęcia
> certyfikatów z aukcji). Fałszywki c + b [literatura], a czasem nawet moje własne jeśli będę
> wiedział że to fals."

So **the reference side is always a plain `Photo`** — no `ScanTile`, no `Box`, no sheet, no dpi — and
no existing screen can show one. `TileZoomView` (1674 lines) is built on `TileSideView`, which is a
tile with a box on a sheet. Nothing here is a matter of extending it.

### The reframing that set the scope

Asked when he actually reaches for this, the collector described neither a purchase decision nor an
adjudication:

> "raczej unikam aukcji ze znaczkami które są znane z fałszarstw, jeśli nie mają gwarancji. Ale
> często kupuję zbiory/klasery, gdzie miewam takie znaczki i chciałbym chociaż wstępnie je sprawdzić,
> zanim odeślę do eksperta"

**This is a triage tool, not a verdict machine.** The question it answers is *is this worth a closer
look*, over a boxful of material from a bought collection. That is the honest goal for the material
described above — nobody adjudicates a stamp from a compressed auction JPEG under somebody else's
lighting — and it is also the work that does not get done today, because it is dull at a hundred
stamps.

Its two errors cost differently and asymmetrically: a false alarm costs a second look, a miss costs
the price of the stamp. **The tool is therefore allowed to be over-sensitive**, and that is a
decision rather than a defect — recorded here so that nobody later "fixes" the balance the other way.

## Decisions

### 1. A forgery is a `Stamp`: a non-variant child of the stamp it imitates (#1000)

Proposed by the collector, and it is the decision the rest follows from:

> "Może by fałszerstwa potraktować jako warianty? Bo zasadniczo identyfikacja wariantu jest bardzo
> zbliżona do identyfikacji fałszerstwa — porównuje się szereg szczegółów."

ADR-0010 §1 already splits subtypes along exactly this line. `actsAsVariant = true` is the
variant-like categories (colour, perforation, paper); `actsAsVariant = false` is the *distinct-entry*
categories, and three are seeded — **Error, Plate flaw, Overprint**. A forgery belongs in the second
column on its own terms: owning the forgery does not complete a series, and it is not the lowest
child price of the genuine stamp.

So the schema change is **one more seeded row**: `Forgery`, `actsAsVariant = false`, in
`DEFAULT_STAMP_SUBTYPES` (`src/lib/subtypes.ts:61`), with a migration seeding it into existing
collections. Nothing else.

**One property of `actsAsVariant = false` makes this safe rather than merely tidy, and it was
verified rather than assumed.** `src/lib/photos.ts:593` — the walk that propagates a promoted photo
up the variant tree (#347, #368) — does `if (!childIsVariant(current)) break;`. **A photo of a
forgery cannot climb onto the genuine stamp.** That is the hazard that sank every design where a
forgery image was a `Photo` on the real stamp, and it is closed here by an existing line written for
another reason.

What this also buys, at no cost: a forgery can be held as stock (an `Item` identified to it), valued,
searched, and — deliberately — sold as a forgery.

### 2. The verdict is the identification. Nothing new is stored

The collector cut this one short, and the cut is the decision:

> "nie idźmy tak głęboko. Z punktu aplikacji to będzie to samo co identyfikacja wariantu — nie
> potrzebuję żadnych nawiązań do ekspertów, itd. Ja tylko sprawdzam — fals czy nie fals."

A copy judged a forgery is **identified to the forgery stamp**, exactly as any variant is. That is
the whole record. It brings `ItemVariantHistory` (dated, with a note) for free, and it means:

- **No authenticity state on `Item`.** No check status, no examination history, no `AuthenticityCheck`
  table, no expert workflow, no "send these to the expert" worklist.
- **A negative result leaves no trace, by design.** "I looked and it seems ordinary" is not recorded,
  because a copy already sitting under the genuine stamp says it.
- **The record does not depend on the reference.** It points at a stamp, not at a photo. Deleting,
  replacing or reclassifying a reference photo cannot touch a verdict, and changing one's mind is
  re-identifying the copy, which is already an audited operation. The question *what happens to a
  stored verdict when its reference changes* therefore **does not arise in this design**, and no
  mechanism is built for it.

Selecting what to examine needs nothing new either. The collector's own route — an issue, then copies
with no certificate — already works: the copies list filters by certificate status with `null` as a
first-class value (`src/lib/items.ts:910`, #428), and groups by issue (#424).

### 3. A reference is an ordinary photo; the variant tree does the labelling (#1001)

Because a forgery is its own `Stamp`, **where a photo hangs already says what it is**. A reference for
a genuine stamp is an extra (`role: null`, with a title) on that stamp; a reference for a forgery is a
photo on the forgery stamp. There is no `kind` value, no reference table, and no new owner on `Photo`.

The exposure this creates was measured rather than guessed:

- **Offer collages cannot reach a stamp's photos at all.** `src/lib/offer-photo-generation.ts:508`
  selects `role in (front, back)` from the **copy**.
- **The album is the one real case, and it is narrow.** `src/lib/album-photos.ts:102` prefers `main`
  and considers extras only as a worse candidate, so a reference can be printed onto an album page
  **only for a stamp that has no `main` photo of its own**.

That is one checkable behaviour, not a sweep across every reader, and it is not worth a new column to
close.

One column is added: **`Photo.sourceUrl`**, nullable, read by nothing existing. With source (c)
dominating, where a reference came from is most of what it is worth, and it is not recoverable from
memory six months later. It is the smallest honest answer to *how do we know this genuine reference is
genuine*.

**Grouping forgeries by forger is deferred to tags (#152)**, which already covers `Stamp` and `Item`
with list filtering. A `ForgeryType` dictionary was designed and rejected: *"Jak będę potrzebował
grupować po typach fałszerstw to sobie to ogarnę tagami."* Nothing here waits for #152; the grouping
simply appears when it lands.

### 4. The comparison is a new, symmetric two-photo view (#1004, #1005; the gap it exposed is #1003)

Both entry points are real — during intake, where the copy is a `ScanTile` with a stated dpi, and on a
copy already held, where it is a plain `Photo` that may never have come from a card scan (#112 uploads
one directly). The reference side never has a dpi.

So the view takes **two `Photo`s** and is symmetric. A tile is an *optional strengthening* of the left
side — the deeper source at higher resolution, plus the existing ruler and gauge — and never the basis;
the opposite arrangement cannot exist, because the right side has no geometry to offer.

**A gap this exposed on the second entry point:** `identify-variant-dialog.tsx` (175 lines), where a
held copy is moved onto a variant, **shows no picture at all** — a stamp tree and a change history. All
the looking machinery hangs off intake. That is its own defect and its own issue, independent of
whether the comparison view is ever built.

### 5. Alignment is by two clicked points, and the scale factor is a result (#1004)

Two clicks on the same landmark on each image yield scale, rotation and translation together. **The
scale the app had to apply is then displayed as a number**, because photo-lithographic forgeries differ
in the size of the printed design by a few percent, and that is a finding rather than a setting. A
free "make it fit" slider destroys exactly that: it is adjusted to zero and never reports what it
absorbed.

Manual adjustment stays available, because with auction JPEGs the two landmarks will sometimes not be
findable, and refusing would make the tool useless in the material it is for. **But manual alignment
shows no figure and is marked as manual** — a scale derived from dragging a mouse is a number nobody
can check, and the project already holds this line: `formatGaugeAt` prints *11½ at 1200 dpi* rather
than *11½*, so an assumption cannot come unstuck from the claim it supports.

Once a pair is aligned, the ways of composing it — opacity, a curtain wipe, a `difference` blend, and
plain toggling — are each a few dozen lines. **Alignment is the work; the modes are nearly free.** The
difference blend is included on the collector's confirmation, not on the assumption that it reads well.

### 6. Rotation splits in two, and the split is forced by the geometry (#1006)

Skew correction (a degree or two) belongs to the comparison view and is a view transform.

**Quarter-turns are a different feature and are wanted independently** — a scan made sideways should be
put right when the photo is added, and on a card scan the turn is **per tile, not per card**. It cannot
be a view transform, and it cannot be a byte rewrite either, without choosing per owner:

- **A tile's `Box` addresses the sheet**, and `1:1`, `regionOnSheet` (`src/lib/scan-viewport.ts:285`)
  and every measurement stand on that correspondence. Rotating a tile's bytes silently breaks it. A
  tile's quarter-turn must therefore be a **stored property of the tile**, applied when it is drawn
  and when it is cut.
- **An ordinary uploaded photo has no such correspondence**, so rewriting its bytes is the cheap and
  safe answer and no reader learns anything.

This is its own issue, not a footnote to the comparison view.

### 7. Selection and protection are one subtype filter on the copies list (#1002)

The collector's answer to the risk of listing a forgery under the genuine stamp's catalogue number —
a misrepresentation on a marketplace, not a cosmetic problem:

> "tu bym chyba potrzebował filtru po typie wariantu na liście inventory. To z poziomu tej listy
> prawie zawsze tworzę oferty. Więc jeśli będę mógł usunąć itemy które są typu fals, to problem
> rozwiązany. Jeśli będę chciał sprzedać taki item […] to z kolei w drugą stronę — zafiltruję tylko do
> nich."

This is better than the three options the session proposed (a forced subtype in the generated title, a
block with a confirmation, or nothing) because **it is not about forgeries**. The copies list already
filters by every other dictionary — `conditionIds`, `certificateStatusIds`, `formatIds`, `areaIds`
(`src/lib/items.ts`) — and subtype is the one missing. It arrives by the established pattern
(multi-select, OR, `MultiSelectFilter`), and it also answers *show me only the printing errors* and
*exclude the overprints*.

Title and description wording for a deliberately-sold forgery stays with the collector. **No listing
guard, no title rule and no publishing block is built.**

## What this deliberately does not do

Recorded so that each is not re-proposed as an oversight.

- **No pre-purchase comparison with no copy involved.** It was raised, and the collector's answer was
  that he avoids ungaranteed lots of frequently-forged material, and meets forgeries inside bought
  collections instead. It is the one case that would need something genuinely new — there is no `Item`
  to identify, so the verdict has nowhere to sit — and it is not worth inventing for a rare case.
- **No `kind` on a reference photo and no reference table.** Superseded by decision 1: the tree already
  labels every reference by where it hangs.
- **No `ForgeryType` dictionary and no forgery-type record carrying named diagnostic features.** Tags
  (#152) cover the grouping; a record of *"this forgery has a broken line under POLSKA"* was designed
  and dropped as premature.
- **No authenticity status, examination history, expert workflow or dispatch list on `Item`.**
- **No mechanism for a verdict whose reference changed.** Decision 2 removes the dependency that would
  make one necessary.
- **No automatic judgement, scoring or "likely forgery" signal.** The tool composes two pictures and
  reports one measured number. It states nothing about authenticity, and it must not begin to.
- **No perforation gauge or watermark work.** Already built (#598, #614, #625), and already compared
  against candidate variants (#740). None of it transfers to a reference photo, which has no dpi.
- **#674 is neither absorbed nor depended on.** Annotating and snapshotting a detail of *one* scan is a
  different job and nothing here blocks on it. One constraint is carried across: the comparison view
  must not foreclose an annotation layer being placed on it later, so that two viewers with their own
  drawing code do not both come to exist.

## Consequences

- The schema gains **one seeded dictionary row** and **one nullable column** (`Photo.sourceUrl`). No
  new table, no new relation, no new owner on `Photo`.
- A forgery becomes ordinary inventory: valued, searchable, storable, sellable, and excluded from
  completeness and from lowest-child valuation by the mechanism ADR-0010 already provides.
- Two behaviours need a deliberate look during implementation, both narrow and both named above: a
  reference extra reaching an album page for a stamp with no `main` photo, and a forgery stamp being
  offered a Colnect identity or reaching a want list (#1007). **Neither is closed by this ADR**, and
  #1007 in particular has an unsettled question in it: `actsAsVariant = false` does not distinguish a
  forgery from an Overprint, and keying on the seeded row's *name* is wrong, because it is an ordinary
  editable dictionary row the collector may rename.
- The comparison view is the only substantial new surface, and it is new because nothing existing can
  display a picture that is not a crop of a scanned sheet.
