# ADR-0048: Stamp Size Presets — A Copied Pair of Numbers, Not a Reference

## Status

Accepted, partly implemented: #803–#806 have landed, #807–#809 have not. Designed 2026-09-06 with the collector. The work is tracked in #803
(the dictionary, the migration and the write module), #804 (the Settings panel), #805 (the row beside
the stamp's width and height), #806 (applying to an issue or a checklist), #807 (choosing one while
creating a stamp range), #808 (multi-select on the stamp tree) and #809 (applying to a tree
selection). It extends #763 (the stamp's
size, **`src/lib/stamp-size.ts`**) and is read by nothing new: everything downstream — the hawid box
rule (#765), the page plan (#767), the PDF (#768), the editor canvas (#769), the cutting list (#770)
— goes on reading `Stamp.widthMm` / `Stamp.heightMm` and never learns that presets exist.

## Context

#763 gave a stamp a size and two ways to obtain one, and both of them need a scan: the ruler in
`TileZoomView`, which converts a dragged line through `Collection.scanDpi` (#598), and the estimate
taken off a `ScanTile`'s crop box. It also gave a stamp with no size of its own a fallback — the
nearest stamp of the **same checklist** that states one, resolved at read time and never stored.

The collector's report is that the boundary of that fallback is exactly where the work is:

> "często będzie tak, że robiąc album czy ogólnie, nie będę miał jeszcze danego znaczka, albo nie
> będę miał jeszcze zeskanowanego, więc nie będę miał skąd pomierzyć jego rozmiarów. Ale mimo to
> będę wiedział jakie ma rozmiary — np. jeśli wprowadzam kolejną serię przedruków Germanii nie muszę
> tego mierzyć bo wiem, że będą takie same jak Germanie gdzie indziej."

Three things are true at once here and no existing mechanism covers their intersection.

- **The stamp is not in hand.** Not bought, or bought and not scanned. Both measuring tools are out,
  and they will stay out for as long as the album page is being planned — which is precisely when
  the size is wanted, because a page cannot be laid out without one.
- **The collector nevertheless knows the figure.** Not as a guess: an overprint run is the same
  impression as the base issue, and he has measured the base issue already, on another checklist,
  probably in another issue, possibly years ago.
- **#763's fallback cannot reach it.** It walks one checklist in catalog sort order, on the argument
  that a series is printed on one press at one size. That argument is sound and it is also the exact
  reason the fallback stops where it does: a new overprint run is *its own* checklist, so there is
  no neighbour to borrow from, and every stamp in it resolves to nothing.

So the missing thing is not a better inheritance rule. It is a way to state a figure the collector
already knows, quickly, for a whole series at once, without a scan and without retyping `25` and `30`
forty times.

## Decisions

### 1. Applying a preset **writes the numbers onto the stamp**. It is typing, made fast

A preset is not referenced, not linked, and not resolved. Choosing one sets `Stamp.widthMm` and
`Stamp.heightMm` to its two figures and the relationship ends there. `Stamp` gains no
`stampSizePresetId`; nothing downstream can tell a stamp sized from a preset from one sized with a
ruler, because there is nothing to tell.

This is #763's own architecture holding rather than a new position. #763 refused an `inherited`
column and an `estimated` flag on one argument: **a size is either set on this stamp or absent, one
source of truth.** A preset reference would be a third state — *set, but somewhere else, and liable
to change under you* — and every surface that draws a box (#769) or cuts a strip (#770) would have to
learn about it. The house has the precedent in the other direction too: `AlbumTemplate` (#766) is a
render preset that is **seeded, never referenced** — choosing one on an album copies its values, the
album holds no `albumTemplateId`, and nothing reads the template at plan time. This is that rule
applied to two numbers instead of forty.

The cost is real and accepted: **correcting a preset does not correct stamps already set from it.**
A preset saved as `25.0 × 30.0` and later found to be `25.0 × 29.5` leaves every stamp it touched
holding the old pair, and fixing them means applying the corrected preset again. That is the same
bargain #766 struck and for the same reason — the alternative is a figure on a printed card that
changed after the card was printed.

### 2. A preset carries **width × height and nothing else**

Not the hawid strip, not a margin, not a box. **The strip is the box rule's answer, not the
preset's**: `hawid.ts` (#765) picks a strip out of the collector's drawer for a stamp, and a preset
carrying its own strip height would be a second claim about a number that rule already decides. The
two would disagree the first time the drawer changed — a page drawn against a strip no longer in
stock, discovered with the card in hand.

That separation earned itself while this was being drafted. **The strip's own geometry was corrected
underneath it, in #793**, which landed on `main` during the design conversation: `HawidStrip.heightMm`
is the number printed on the packet — the height of the stamp the mount *takes*, a 26 mm packet being
itself about 30 mm tall because the welded border is part of the product — while `hawid.ts` read it as
both the capacity to test against and the height to draw, so it skipped the packet a stamp belongs in
and then drew the box shorter than the mount about to be glued down. `HawidStrip` now carries
`totalHeightMm` beside it, selection compares against the total, the box is drawn at the total, and a
total of `0` means *not measured yet*. It took a migration.

Nothing in this ADR moved. It states no strip arithmetic at all, names no strip column, and its
issues read none — which is the whole value of decision 2, demonstrated within a day of being taken:
**had the preset carried a strip height, every issue below would have needed rewriting the moment
#793 landed.** Anything about strips is #765's.

The collector's word was "geometrii", plural, and this is the deliberate narrowing of it: presets
are for the one figure that cannot be obtained without the stamp. Everything else in the album's
geometry belongs to the template or the drawer, both of which already exist and are already edited
in Settings → Albums.

### 3. The **numbers are the identity**; the name is an optional label

`@@unique([collectionId, widthMm, heightMm])`. A name — `Germania` — is nullable, and the picker
reads `25 × 30 mm · Germania`, or plain `25 × 30 mm` when there is none.

This is `HawidStrip`'s shape exactly (`@@unique([collectionId, heightMm])`, `label String?`, "a
height is already an identity") and it is right here for a second reason that strip did not have:
**decision 5 saves a preset from the middle of a measurement.** A required name would put a text
field between finishing a measurement and keeping it, which is the moment the whole feature exists
to make cheap. Two presets with the same pair are one preset; the app reports the collision as its
own error rather than as a failed save, `HawidStrip`'s convention.

### 4. Applying is one operation over a **subject**, offered from four places

The four entry points the collector asked for are four ways of naming a set of stamps, not four
features:

- **The stamp-range dialog** (`add-stamp-range-dialog.tsx`), where a series is created. The Germania
  case in its purest form: type `Mi 1-20`, pick the preset, and the stamps are born with a size.
  Nothing can be overwritten here because nothing exists yet.
- **An issue**, from its row on the Issues list.
- **A checklist.**
- **A selection of stamps** on the stamp tree.

One write module takes `{ presetId, subject }` where the subject is an issue, a checklist, or an
explicit list of stamp ids, resolves it to stamp ids, and writes. The four entry points differ only in
how they name the subject.

The selection case is deliberately the last of the four to be built, and it is **two** pieces of
work rather than one: the stamp tree has no multi-select today, so applying a preset to a selection
first needs a selection to exist. Multi-select is an independent capability with value well beyond
presets, so it gets its own issue rather than riding along inside this one.

It is not starting from nothing, and saying "this does not exist" without that caveat is true of the
tree and misleading about the app: **multi-select with bulk actions is already built on the inventory
list** (#373, #682, #683, #723, #497). The tree work follows that established pattern — its selection
model, its bulk-action affordance and its confirmation shape — rather than inventing a second one, and
the only genuinely new question is what selecting a node means for the children under it, which is
answered by the same subtree rule as decision 7 — every descendant at any depth, variant or not.

### 5. A preset is created from **one button beside the width/height fields**

On the attributes tab of the stamp dialog (#736/#761), next to the pair of inputs, enabled only when
both are complete. It saves **whatever is in the fields at that moment** — typed by hand, taken from
the ruler, or taken from the crop estimate.

That single placement is what answers "z miejsca gdzie mierzę / wprowadzam wymiary" without adding a
second way for an estimate to escape. #763's own rule is that a proposal is a number on screen beside
a field and stays one until the collector presses it: the crop estimate is "a good first guess and a
bad fact", the stamp plus whatever slack the cut carried. A *save as preset* button on the estimate's
own row would let that slack be promoted to a named figure and then applied to forty stamps in one
click, which is the worst outcome this whole design can produce. Routing every preset through the
fields means an estimate becomes a preset only after the collector has already accepted it as this
stamp's size — an act #763 made deliberate on purpose.

The button does not open a form. It saves the pair, with no name, and says so; naming and reordering
happen in Settings (decision 7). A pair already stored is reported as such rather than duplicated.

### 6. Application is **previewed before it writes, and defaults to skipping stated sizes**

The apply dialog states its counts before anything is written: *17 stamps have no size and will get
25 × 30 mm; 3 already state one.* Overwriting those three is a checkbox, and it is **unchecked**.

This is the only irreversible thing in the design. A stated size is either a measurement taken with
the ruler at a stated dpi or a figure the collector typed on purpose; a bulk write that silently
replaced it would destroy the most expensive data in the feature with the same click that fills in
the cheapest. Skipping-by-default keeps the destructive act possible — a series where an early figure
was wrong is exactly what a preset should be able to correct — but makes it a second, separate
decision, taken with the counts on screen.

There is nothing to preview about *inherited* sizes: #763 stores none, so a stamp resolving through
its checklist is, to this write, a stamp with no size.

### 7. Applying descends the **whole subtree, every descendant at any depth**

Applying to an issue or a checklist reaches every member and every descendant of every member, at any
depth: `309`, `309A`, `309AP`, `309APa`.

This is not a breach of #763's "nothing is inherited down the variant tree", and the distinction is
worth stating because it will look like one. That rule is about **resolution** — a child does not
*read* its parent's value, it states its own or none. This decision is about a **write**: the
collector is asserting a figure about a printing, and a variant of an overprint is the same
impression on the same paper. Writing it to the subtree stores a real value on each stamp, which is
what every other size in the app is. Leaving the subtree out would leave exactly the stamps that
reach an album page — variants are what a specialized page is made of — sizeless, and they would then
fall back to a checklist neighbour anyway, which is the borrowing this feature exists to avoid.

**The walk is not gated on `actsAsVariant`, and a child filed as a distinct entry — an error, a plate
flaw, an overprint — takes the figure exactly as a variant does.** *Decided with the collector,
2026-09-06.* This paragraph exists because the argument above reaches only variants and was read, on
the strength of the heading this decision used to carry, as implying the opposite: that the walk
should filter `childIsVariant` at every level the way `checklist-variant-rollup.ts` does.

The reason it does not is that **a size is a fact about the paper, not about what counts as a separate
thing to collect.** `actsAsVariant` is the collector's own classification, per subtype and
overridable per stamp (`variant-classification.ts`), and what it classifies is *collecting*:
ADR-0010 §3 uses it to decide whether holding a child is another way of holding its parent, which is
why the completeness rollup, the unknown-variant valuation and the headline-price rollup all consult
it. None of those is a question about millimetres. A plate flaw under `309` came off the same press
at the same size, and it is as much a part of a specialized page as `309A` is — so gating this write
on that flag would answer a question about paper with an answer about collecting, and would leave
sizeless a stamp whose size nobody doubts.

That is the same resolution-versus-write distinction the paragraph above draws, applied one level
further in: the flag governs what a copy *counts as*, never what a stamp *measures*.

The preview from decision 6 counts the subtree, so the number of stamps about to be touched is on
screen before the write.

### 8. A collection-level dictionary, edited in **Settings → Attributes**, seeded with nothing

`collectionId`-scoped like every dictionary in this schema, with a dragged `sortOrder` and a text
filter in the picker rather than a most-recently-used ordering. The panel sits beside the four
attribute dictionaries (`StampColor`, `StampWatermark`, `StampPaper`, `StampPrinting`) because size
is the seventh and eighth stamp attribute on exactly their terms (#763) — catalogue identity — and
because that is the tab the collector is already on when he is filling in an attributes tab. The
alternative, Settings → Albums beside the hawid drawer, was weighed and refused: a stamp's size is a
catalogue fact for a collection that never prints a page.

**Nothing is seeded**, in a real collection or in the demo dataset. This is the project's standing
habit — `HawidStrip`, the four attribute dictionaries and `StampFormat` all start empty — and it has
a sharper form here: a seeded preset is the app asserting a millimetre nobody measured, and the
collector cuts material to it. An empty list should look unfilled, exactly as an empty hawid drawer
makes every box oversize rather than quietly taking a default.

**Not translatable.** Dictionaries in this app are translatable when their values reach a listing a
buyer reads (#344, `StampColorTranslation` and its three siblings). A preset name never leaves the
collector's own screen — it is not written to a stamp, so it cannot reach a listing token, an export
or a marketplace description; the only thing that travels is the pair of numbers, which is not
language. So no `StampSizePresetTranslation` table, stated here so that the omission reads as a
decision rather than as an oversight.

## Deliberately left out

- **A reference from `Stamp` to a preset**, and therefore any propagation of a later correction.
  Decision 1 is the whole design; a `stampSizePresetId` column undoes it.
- **A hawid strip, clearance or box on the preset.** Decision 2. That is `hawid.ts` and the album
  template, and a second copy of either would be a page that disagrees with the drawer — as #793
  demonstrated by changing that model out from under this file.
- **A *save as preset* action on the ruler's reading or the crop estimate.** Decision 5. Both reach
  presets through the fields, so that an estimate is promoted only after being accepted.
- **Most-recently-used ordering, and a `lastUsedAt` column.** A dragged order plus a filter field
  costs no column and no write per application, and a list that reorders itself cannot be found by
  muscle memory. Revisit if the collector reports hunting through the picker.
- **Presets shared between collections.** Nothing in this schema is, and a size dictionary is not the
  place to introduce cross-collection data.
- **Bulk *clearing* of sizes.** Applying a preset writes a pair; there is no preset that means *no
  size*, and a bulk erase is a different act with a different confirmation. A stamp's size is cleared
  on the stamp, where it is set.
- **A preset applied to an area, a period or a whole collection.** The four subjects in decision 4
  are the ones that correspond to a printing. An area spans a century of presses.

## Consequences

- `src/lib/stamp-size.ts` gains nothing. The resolution rule, the parsing and the rounding are
  unchanged, and `resolveStampSize`'s checklist fallback stays exactly as it is — it is what a
  collection that has not used presets still relies on, and what covers stamps a preset was never
  applied to. A preset simply means more stamps state their own size, which is the state the fallback
  was always the substitute for.
- The write goes through the same parse as a typed figure (`parseStampSizeInput`, #763): a preset's
  numbers are rounded to `SIZE_DECIMALS` on the way in, and a stored `Decimal(5, 1)` pair matching the
  stamp's own columns means the value shown in the picker is byte-for-byte the value that lands.
- `docs/agents/catalog-and-stamps.md` carries the size bullet and gains the preset paragraph, and
  `docs/agents/albums.md` needs no change: the album track reads sizes and does not care where they
  came from.
- Anyone adding a `stampSizePresetId` to `Stamp`, a strip height to the preset, or a *save as preset*
  button to the crop estimate's row is undoing decisions 1, 2 and 5 rather than completing them. Read
  this file first.

## Related

- #763 — the stamp's size, the fallback whose boundary this addresses, `src/lib/stamp-size.ts`
- #765 / `docs/agents/albums.md` — the hawid box rule, which decision 2 refuses to duplicate
- #793 — the correction to that rule's strip model (`HawidStrip.totalHeightMm`, and what selection
  compares), landed while this was being written and touching nothing here
- #766 / ADR-0045 — `AlbumTemplate`, the *seeded, never referenced* precedent decision 1 follows
- #736 / #761 — the attributes tab, where the size fields and the *save as preset* button live
- #598 — `Collection.scanDpi`, the scale the ruler and the crop estimate convert through
- #71 / #72 — the stamp-attribute track and the Settings → Attributes tab decision 8 joins
