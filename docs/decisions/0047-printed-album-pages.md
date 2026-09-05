# ADR-0047: Printed Album Pages — A Stored Result, A Reported Divergence, And Two Answers

## Status

Accepted, implemented in #778. It completes the model of [ADR-0045](0045-album-model.md) (#767) and
is drawn by the renderer of [ADR-0046](0046-album-pdf-rendering.md) (#768). The design is #755, which
states every decision below in the collector's own terms; this file records why each is shaped the
way it is in the code.

## Context

A card that has been printed and glued into is a physical object. The data it was made from goes on
changing — a series is renamed, a stamp joins a checklist, a measured size is corrected, the album's
language changes — and none of that may reach backwards into the sheet in the binder.

ADR-0045 left exactly one thing for this: `AlbumBlockSpec.printedPageId`, the seam by which a block
says it is already on paper, always null until now. Everything else about a printed page — what it
stores, how it is marked, what it means when the collection has moved on from it, and what the
collector does about that — is decided here.

## Decisions

### 1. A printed page is a stored result, not a flag

The row keeps what went onto the paper: the resolved texts already translated and already wrapped,
the box geometry in millimetres as placed, the stamps and their order, the catalog range that is its
identity, the strip each box was cut from, the picture each mount printed, and the render preset the
sheet was set under. It is immutable from that moment, and a renderer drawing it resolves nothing.

**A `frozen` boolean on the recompute path was the obvious alternative and is the bug this whole
issue exists to prevent.** A flag stops the *layout* being re-planned while every text and every
dimension goes on resolving from live data — so renaming an issue would quietly change what a reprint
produces, and the reprint would no longer match the card it is supposed to replace. The whole point
is that a reprint a year later is *the same sheet*.

Two consequences follow from that and are load-bearing:

- **The strip is copied, not referenced.** The hawid stock is the one part of an album read live
  (ADR-0045 §4) — it is a statement about a drawer, and a drawer changes — so a printed box carries
  the strip's height, stock length and label rather than a foreign key to a row that may since have
  been renamed, sold out or deleted.
- **The render preset is copied whole**, and `album-pdf.ts` therefore takes a preset per sheet rather
  than reading the album's own columns. An album whose margins or faces have moved since a card was
  printed must still reprint *that card*; a renderer reaching for `album.marginTopMm` while drawing a
  snapshot would produce a sheet that is neither the old card nor a new one.

### 2. The snapshot is JSON; the stamps on it are rows

`album_printed_page.snapshot` is a **result**: written once, read whole by a renderer and by the
divergence report, never joined against or filtered on. A table of placements would be a
normalisation of something nobody queries.

What *is* queried, on every read of the album screen, is *which stamps of this album are already on
paper* — so that is `album_printed_page_stamp` beside it, **derived from the same snapshot in the
same transaction and written from nowhere else**. Answering it from the snapshots would load a few
hundred pages of geometry to look at a list of ids.

It is keyed `(albumPrintedPageId, albumEntryId, stampId)`, and the entry in that key is not defensive
over-keying. **A stamp can be on two checklists of one issue** — basic and specialized, perforated
and imperforate (ADR-0031) — and an album gathers both from the same area, so both can land on one
sheet. That is *two boxes on the card*, and therefore two rows; the first version of this key was
`(page, stamp)` and refused to store such a sheet at all.

The fact generalises past this table and is worth stating once here: **the unit on a card is a box,
and a box is a slot rather than a stamp.** Anything that counts what a card needs — #770's cutting
list above all — counts boxes, or it asks the collector to cut too few hawids and he finds out at the
desk with the card already in front of him. #770 obeys it structurally rather than carefully:
`album-cutting-list.ts` carries no stamp id at all, so there is nothing in it a count could be keyed
on or deduplicated by.

### 3. Marking a page printed is a deliberate act

Generating a PDF marks nothing. A draft is generated to be looked at, and an album that froze itself
on the first preview would be a trap.

The gesture takes **positions** in the listing on screen, exactly as `?sheets=` does for printing
(ADR-0046 §7) — but it is a *write*, and a position read from a plan that has since moved would
freeze the wrong card. So it carries `albumPlanFingerprint` of the plan those positions were read
from, and a mark against a plan that no longer matches is refused rather than applied to whatever now
sits at those positions. That is what lets a position stay a position: it means something only
against the plan that produced it, and the fingerprint is the proof that it still does.

The fingerprint covers **sheet composition and nothing else** — which sheets there are, in what
order, and which entry's stamps are on each — and deliberately not the rendered texts, the geometry
or the range. A retyped heading or a moved template margin changes none of *which card a position
names*, and a refusal the collector cannot account for is one they learn to click through, which
would cost more than the case it guards. A printed sheet contributes its own id, that being its
identity and the one thing about it that can be reordered.

**Reprinting is a different act and takes the card's own identity**, never a position, because it is
the operation where selecting the wrong card is expensive — the collector is about to take one out of
a binder.

### 4. A block's sheets are a list, and it goes onto paper whole or not at all

`AlbumBlockSpec.printedPageId` became `printedPageIds: readonly string[] | null`, index `n` carrying
`part` `n + 1`. A checklist too tall for a page is split across two or three sheets and every one of
them is in the binder; a block that could name only one could not be marked printed at all without
lying about where half of it is. Half a checklist on paper and half in the live plan is not a state
anything could draw, so the mark refuses a partial selection. The refusal is not a normalisation
waiting to happen, so it hands back something actionable: it names the run **and the sheets missing
from the selection**, while the listing says which sheets go together up front
(`AlbumPlanPageView.runWith`) rather than leaving the collector to discover it from an error.

Two smaller corrections came with it, both reachable only now that a printed sheet can exist:

- **A sheet is filed exactly once**, where its first block puts it. Entries can be reordered after
  printing, separating a sheet's blocks; #767 then emitted that sheet twice, which would list, draw
  and reprint one card twice. There is no arrangement that makes a reordered printed sheet read
  correctly, but there is one that keeps it a single card.
- **A chapter whose first block is on paper does not print its year again.** The card in the binder
  carries that heading, and an album with every chapter printed would otherwise be a run of blank
  sheets each headed with a year. (Not the same case as a year heading legitimately alone on a sheet,
  ADR-0046 — there the content under it moved to the next *live* page.)

The two are **one family**, and it is not the measurement family `docs/agents/albums.md` records for
this module: their shape is *the live plan producing again something a printed sheet already accounts
for*. Anything that steps over printed sheets has to ask what they already account for — position,
chapter heading, stamps so far, and the list is not obviously closed. The inputs that separate
"stepped over" from "left out" are an album with **every page printed** and one whose entries were
**reordered after printing**; both are in `tests/unit/album-layout.test.ts`, and #769 and #770 step
over printed sheets too.

#770 has since done so, and its answer is worth recording because it turned up a **limit of this
model** rather than another instance of the bug. Its per-sheet lists cover printed cards, read from
their snapshots — §9 is what makes that possible. Its album-level demand cannot be a single figure at
all, and the reason is that **this ADR records printing and not mounting**: the collector marks a
sheet printed as it comes off the printer and cuts for it afterwards, so a card being on paper says
nothing about whether its hawid exists yet. A demand over everything counts material mounted a year
ago; a demand over the live sheets alone leaves out the run he is about to sit down with. So there
are two figures, never summed, printed cards first, and each printed sheet carries the minute it went
onto paper so the run is visible. A rule deciding *these are mounted and those are not* was
considered and rejected — the model holds no such fact, and inventing one is how a figure someone
cuts to becomes wrong.

Both of §4's inputs are constructed again in `tests/unit/album-cutting-list.test.ts`, over
`planAlbumPages` with stand-in snapshots, because the mapping from a plan page to a cutting sheet is
where *stepping over* is answered and it is not reachable through Prisma.
`docs/agents/albums.md` carries the rest.

### 5. The divergence report is compared against the card's own entries, re-planned on fresh paper

A printed sheet has no live counterpart: the plan steps over it. So the reference is built **per
printed card** — the maximal group of sheets joined by a block that spans them, one sheet in the
ordinary case — by re-planning that card's own entries on fresh paper, through the same
`albumPlanContext` the live plan uses so the sizes, boxes, texts and range cannot be resolved twice
two ways.

The alternative was the literal reading of ADR-0045 §3: re-plan the whole album as if nothing were
printed, and pair its pages against the snapshots. It was rejected because **it cascades**. One stamp
joining an early checklist re-flows every later sheet, so the report says *sheet 3 lost X gained Y,
sheet 4 lost Y gained Z* for a dozen cards — the "drowned by ordinary collecting" failure #778 exists
to prevent, arriving by a different door, and a direct contradiction of the dividend the
range-as-identity decision was made for: an insertion disturbs the one card it lands on.

And per-card is not an approximation of per-album — the two answer different questions. A printed
sheet is a claim about **its own entries** and nothing else, so a stamp joining a checklist three
chapters earlier is not a fact about it, and asking the album-wide question imports context the card
never had. The cascade is that mistake showing up as noise rather than being the mistake itself.

It is also simply what the planner does. A printed sheet is a page boundary and the plan **resumes on
fresh paper** after it, so a card's own content never re-flows across its edge — re-planning those
entries in isolation is not an approximation of the planner's answer, it *is* the planner's answer.
The
first sheet of a split block is at the top of a full page by construction, and a card that opened its
chapter is re-planned with its chapter heading and one that did not without — otherwise every
chapter's first card would report its own year heading as newly arrived. Whether a card carried one
is a **fact about the printed sheet**, so it is read from the snapshot's own placed chapter text,
beside the strip heights, rather than inferred from where the card happens to sit now.

The reference deliberately **excludes** two kinds of stamp:

- stamps of the same entry that are on some *other* printed card — otherwise the moment a
  continuation page is printed, the card it continues would report the continuation's stamps as
  missing from it, for ever;
- stamps waiting on a continuation the collector has already opened — that divergence has been
  answered, and repeating it on every read is how a report stops being read.

### 6. Cards are grouped by a block that spans them, not by a checklist they share

The two are not the same, and the difference *is* the continuation page. A continuation carries the
same checklist onto a card of its own, printed later, deliberately kept separate; grouping the two
would re-plan them together and produce the single card the collector chose **not** to make when they
answered with a continuation rather than a reprint.

The signal is the **snapshot's own block part**, which is the layout's: a split block's sheets carry
parts 1, 2, 3, while a continuation starts again at 1 because it was planned as a fresh block. The
index's `part` column is offset when a continuation is marked printed, so an entry's cards stay in
filing order, and is deliberately not what the grouping reads.

### 7. Pages pair by contents, and a page that merely moved is nothing

ADR-0045 §3 carried both rules forward and this is where they are written. `album-divergence.ts` is
pure and unit-tested on plain values.

A page's name is its catalog range and a range is derived from its contents, so the moment a page
changes at all its identity changes too: pairing by identity would report every real change as one
page removed and another added, loudest exactly where it is least informative. So pages pair by
**greatest shared-stamp overlap**, ties broken by the smaller displacement, and pages carrying no
stamps pair **positionally** since nothing distinguishes them. Nothing else reads an index.

The comparison itself is over **facts, not coordinates**: the stamps and their order, each box's cut
size and strip, the texts as they read, the pictures, the preset. Not x and y — a position is a
*consequence* of those, so a margin moved by a tenth of a millimetre would otherwise report every box
on every card as changed. For the same reason the **footer is not reported when the stamps are what
changed**: it names the sheet's own range, so a checklist that gains a stamp changes it by
arithmetic, and saying so beside *1 stamp the card does not carry* would double the report on the
most common divergence there is.

### 8. The kinds are ranked, and a photo is last

`stamps`, `size`, `text`, `template`, `photo`, and the order is the report's order. Structural first
because the card is missing a slot; size next because a hawid cut to the old figure is gone; then
wrong words, then a moved preset.

**`photo` is last on purpose.** A picture arriving after a card was printed is a real divergence — the
card lacks an image it could now have — and it will be far more common than a rename while being
worth far less: one bulk scanning session touches hundreds of stamps. Ranked with the others it would
bury every genuine finding on the first day the collector sits down with a scanner.

### 9. What a card may carry

A printed card may state only what stays true of the **objects** it describes. A catalog number, a
name, an issue date, a box size, the page's range — all stable. Anything that is a function of what
the collector *owns* — a completion count, a valuation, an owned/wanted marker — may not, and under
this ADR it is worse than stale: every acquisition would register as a divergence on every page
carrying it.

The distinction is **printed onto the card**, not *shown about the card*, and it is as easy to
misapply in the opposite direction. The inherited-size and oversize flags on the album screen and in
the page editor (#769) have exactly the same staleness property and are shown deliberately — on
screen, before printing, never onto the paper. They enter no snapshot and can diverge from nothing.
`AlbumSnapshotBox.sizeSource` is in the snapshot for the same reason `catalogSortKey` is: a fact
about how the box was arrived at, kept so the cutting list and the editor can still say so. It is not
printed and it is not compared.

### 10. Two answers, chosen each time, and a third act that is not one of them

Divergence is **reported, never resolved**. A card can be out of date for a good reason and stay that
way for years.

- **A continuation page.** `AlbumEntry.continuesPrintedPageId` set says: plan the stamps of this entry
  that are on no sheet yet as a block of their own, filed after the sheets that already carry it,
  with its own catalog range (`PL 306`). It is **cleared when that continuation is itself marked
  printed**, because the choice is per divergence and not a setting — the next stamp to arrive asks
  again. Null, the state every entry starts in, is ADR-0045's deliberate silence: a stamp joining a
  checklist whose card is in a binder appears nowhere until the collector gives it a home, and
  inventing one would hide what they need to be told.
  The stamp set is **derived, not frozen**: a second stamp arriving before the continuation is
  printed lands on the continuation that is still on screen.
- **A reprint.** `album_printed_page.reprintingAt` set takes the card's content out of the printed
  index, so it returns to the live plan and is re-planned in full, while the row survives to say that
  a superseded card is still in the binder.

  The intermediate state is the decision here, and the physical situation settles it: between
  choosing to reprint and actually mounting the new card, the old one is still the object in the
  binder, and that gap is however long it takes to get to a printer. Making reprint a synonym for
  un-printing would have the album forget what physically exists at exactly the moment the collector
  is most likely to be interrupted — the loss this whole ADR exists to prevent, arriving on the one
  path that is supposed to be the careful one.

  *The snapshot is replaced only when the new sheet is marked printed in its turn* — so the row is
  discarded exactly when every **stamp** it holds is on a card that is not itself awaiting one, which
  is what makes it work when the replacement comes out as two sheets rather than one. A reprint half
  done leaves it standing, and a reprint never finished stays that way **indefinitely and without
  nagging**: nothing sweeps it, and *I will get to it* is a legitimate answer for years.

  An open continuation on the card **folds away with it**, by construction rather than by a rule: the
  reprint takes the card out of the printed index, so the entry plans live and whole, and a
  continuation block is only ever emitted for an entry that has something on paper. The flag is left
  standing on purpose — cancelling restores exactly the state that was there before, and finishing
  clears it along with every other continuation the new sheets answer. What must not happen is a
  continuation surviving beside a re-planned parent as a second card claiming the same stamps.
- **Un-printing** is neither, and is loud. It throws the stored result away and says first what will
  change, from the server's own account of that particular card rather than from a sentence written
  in the component. Any open continuation answering the discarded sheet goes with it (`SET NULL`),
  because there is then nothing to continue.

## Consequences

- The report is a second read of the album (`getAlbumPrintedReport`), and it has to be: it plans each
  printed card again on its own, which is not something the album's plan produces.
- `albumPlanContext` exists so both readers resolve identically. Anything that plans an album must go
  through it; a second reader is a second answer, and the wrong one is the one that says a card in a
  binder is fine.
- `AlbumPlacedBlock` gained `heading` — the string *this sheet* printed, which is the marked
  `[2]`/`[3]` one on a continuation sheet. `page.headings` holds nothing for a blank heading and so
  cannot be indexed by block; a surface reading the block's raw heading would say a card carries a
  heading it does not.
- A snapshot this build cannot read is **refused by version**, not guessed at — the same asymmetry as
  ADR-0046 §5. A card is not a derivation.
- Anyone reaching for a `frozen` boolean, for a whole-album shadow plan to diff against, or for the
  live sheet selector to identify a card for reprinting is undoing decisions 1, 5 and 3 respectively.
  Read this file first.
