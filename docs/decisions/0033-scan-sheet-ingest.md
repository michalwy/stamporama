# ADR-0033: Scan Sheet Ingest — Tiles, and Cutting Before the Pipeline

## Status

Accepted

## Context

Intake photography today is **per copy**, inside the add/edit dialog. That forces identification and
photography to alternate stamp by stamp: pick a stamp up, identify it, type it in, scan it, put it
down. Every piece is handled physically as many times as the desk work takes.

Scanning a whole stockbook card first inverts the order. Each stamp is handled **once** — laid on the
card and, for the backs, turned over **in place** so the second scan has an identical layout — and
everything after that happens at the keyboard, from images.

That leaves the app holding something it has no home for: **an image of a stamp nobody has identified
yet**. This ADR is about where that lives, and about one ordering that is easy to get backwards and
impossible to notice afterwards.

Two things are deliberately outside it. Turning a tile into a copy is **#567**. Proposing the regions
automatically is **#574** — split out because it is blocked on real scans to calibrate against and
none of the rest was, and because the manual editor it feeds is the primitive, not its fallback.

## Decisions

### 1. A tile is its own entity, owned by the **purchase** — and, since #725, by the **collection** with the purchase optional; `Item` is not it

`Item.stampId` is `NOT NULL` and stays that way, so an unidentified stub copy cannot be an `Item`.

Making it nullable is the tempting fix and the wrong one. Every read in the app assumes a copy points
at a stamp — valuation, catalogue-list copy counts, checklist completeness, wants, offer sets, cost
allocation — and each would have to grow its own exclusion, with every place missed surfacing later
as a number that is quietly wrong.

**Lot closing decides it.** Closing splits the lot's pool across its copies by primary-catalog price,
and is deliberately allowed *before* the parcel physically arrives (ADR-0009 §3/§5). A tile has no
stamp, therefore no price, therefore no weight in that split. As a separate entity it is simply not
in the split at all — no exclusion to write and none to forget — and the lot header can warn
*24 tiles unidentified* before closing. A **warning, never a block**, matching how the existing
`N to sort` warning behaves: the arithmetic is fine without them, it is the collector's memory that
needs the nudge.

`ScanTile` therefore carries where it came from, its position in reading order, its batch, and its
state (`unidentified` / `consumed` / `discarded`). Only the first is reachable here; the other two
are #567's.

**It hangs off the `Purchase`, not off one of its lots** — corrected by #586, and the original call
was wrong. A lot fits a stockbook, which is one priced line. It breaks on the other ordinary case:
twenty single stamps won at one auction settle into twenty lots on one purchase (ADR-0009), arrive
as one parcel, and are scanned on one or two cards. Per lot a tile could become a copy on no line
but the one its sheet was uploaded under, so the card could not be worked through at all — and the
**batch number stopped meaning anything**, *batch 1* existing twenty times over in one purchase
while a card scanned "into lot 7" was invisible from the other nineteen.

The deeper reason is not a workaround. At a settlement the collector **does not know which lot a
stamp belongs to until they have identified it**, so asking for the lot at scanning time asks the
question before it can be answered. Moving up therefore improves the flow rather than merely
unblocking it: the *assign to an existing copy* list becomes every copy on the **purchase** still
needing photographs, which is precisely the set one is matching a scanned stamp against when twenty
lines arrived in one envelope.

A copy still belongs to a lot, so **identification asks which** (`scan-tiles.ts`): silently when the
purchase has one, otherwise put to the collector and **remembered**, the way the other intake
answers are (`add-copy-defaults.ts`) — a card, or a run of them, is worked through before the next
is started. *Assign to an existing copy* asks nothing; the copy already has its lot. A **default lot
on the batch** was considered and rejected: a purchase of many small lots puts a dozen on one card,
so a pointer from the card to a lot would be false rather than merely unhelpful. What a card
genuinely wants is a **name** — see #587 below.

Ownership moving is a change to the **cascades**, not only to a column. Deleting a lot no longer
takes sheets or tiles with it: the parcel they were cut from is still here, and so is every other
line the same card holds pieces of. A tile that had already become a copy on that lot keeps its
record and its `itemId` goes null through #567's `SetNull` — the case the strip already draws in
words as *copy deleted*. Deleting the **purchase** is what takes the scans and their bytes.

### 2. The tile's images **are** `Photo` rows, under a fourth owner

A crop of a stamp is a photo of a stamp. It wants the same two derivatives, the same serving route
and the same byte cleanup as any other. So `Photo` gains `tileId` beside `itemId` / `stampId` /
`offerId`, with the owner CHECK widened to `num_nonnulls(...) = 1` and a partial unique on
`(tileId, role)` — the path #137 and #311 have already walked twice.

This is also what makes #567 cheap: "the tile's images move onto the new copy" is a reassignment of
one column, not a byte copy.

### 3. The **sheet** is not a `Photo`, and is retained

The opposite call, for the opposite reason. A `Photo` is two *derivatives* of something and the
upload's own bytes are discarded. A sheet is the reverse: the bytes are the point.

- It must never be downscaled, because the cut is taken from it.
- It needs an `original` variant the closed `PhotoVariant` union (`full` | `thumb`) has no room for.
- It would have to be excluded from every existing photo reader — the storage total, the collage's
  true-size scaling, the item and stamp listings — which is decision 1's mistake in a second place.

So `ScanSheet` is its own table with its own storage key (`<collectionId>/sheets/<sheetId>`), its own
two variants (`original`, `view`) and its own serving route. `view` is a `FULL_MAX_EDGE`-capped copy,
because the review editor cannot be handed a 30 Mpx image and the original must never be the thing on
screen.

**Retention is what makes a bad cut recoverable.** A stockbook cannot be re-scanned once it has been
broken up, so the scan is kept and a batch's tiles can be discarded and cut again from it after the
fact. One retained file per 15–20 stamps is cheap; the alternative is unrecoverable.

Retained originals are far the largest objects the app stores, so they are **counted in the
collection's storage total** (a figure that left the biggest files out would be the one number an
operator sizing a volume must not be given) and their bytes are removed on lot and purchase delete —
addresses read *before* the row delete, files removed *after* it, because that delete can be refused.

### 4. The cut happens on the original, **before** the photo pipeline

`processImage` caps every upload at `FULL_MAX_EDGE` (2500 px). Push a sheet through that and then cut
it, and a card of forty yields ~600 px tiles: the sheet has spent its resolution on being a sheet.
Cut first and each ~800 px crop (600 dpi card) goes through the pipeline as if it had been
photographed alone, comfortably inside the cap with no downscale at all.

The failure this prevents is silent. Tiles cut the wrong way round look fine, merely soft — and by
the time anyone notices, the stockbook has been broken up. Hence this decision written down, and
hence `photos/sheet.ts` carrying the reasoning at the only place that could get it wrong.

Crops are `extract`ed from a single shared decode, so a card of forty decodes the sheet once.
Orientation is normalised by `.rotate()` on every read and the sheet's recorded dimensions are the
oriented ones, so a box drawn on screen and a box handed to `extract` mean the same thing.

### 5. Pairing is by position, and there is no mirroring

Each stamp is turned over **in place**, so a back region sits where its front sat. A back is matched
to the front whose **centre is nearest**, and the match must be **mutual**.

Not tile *n* to tile *n*: an ordering can differ between two scans over one stamp nudged while
turning or one region drawn differently, and index matching would pair the wrong two stamps in
silence.

**No mirroring.** The warning about mirroring is real when a whole group is turned over at once;
applying it to a card turned stamp by stamp would break exactly the correspondence the routine
guarantees.

Centres are compared in **fractional sheet coordinates**, so a back scanned at a different size still
lines up. Mutuality is the only guard — there is deliberately no distance cap, which would be one
more constant to be wrong about.

A differing count is a **signal, not a failure to hide**: the commit reports *front 12, back 11* and
names which fronts found no back, because it means a stamp fell out, two were drawn as one, or the
wrong file was uploaded.

**Equal counts are the precondition for pairing at all** (#647). Mutuality was expected to carry the
sparse case — backs scanned for only some of the stamps — and it does not: with a subset on the
second card, the missing stamps' neighbours become each other's nearest, the match is mutual, and
most backs land one square off. So a mismatch pairs **nothing** and every back goes to the manual
path. A count is a weak signal for *the same card turned over*, and deliberately so: it is the one
signal that is cheap, exact and impossible to be subtly wrong about, and the two errors are not
symmetric — being wrongly turned away from the fast path costs a drag per stamp, while being wrongly
admitted to it costs a mis-paired card nobody notices. `CutReport.pairingMode` carries which path was
taken, because on the manual one *no back found for tile 3, 5, 9* would describe a search that never
ran.

An unmatched **back** becomes a **back-only tile**, shown in an unpaired strip and dragged onto a
front tile. That is the sparse case handled with the same entity and the same images rather than a
third mode. Dropping it re-owns the `Photo` row and deletes the emptied tile.

**A paired back can be taken off again** (#648, `unpairTileBack`) — the same move in reverse: the
back becomes a back-only tile appended to the batch and is placed by the same drag. Without it the
only undo for a mis-pairing was deleting the batch, which throws away every tile identified beside
it, and re-cutting is refused as soon as one of them has become a copy. Unpairing clears the batch's
`batchDoneAt` for the reason returning a tile to the queue does: a card with a back still to be
placed is not finished with, and #578 sweeps the retained scans of ones that are. It is refused on a
settled tile — a consumed tile's images belong to its copy, and a discarded one is one press from
being back in the queue.

### 6. The review editor is the primitive, not a fallback

However good detection gets, it will sometimes take two touching stamps for one, halve a dark one, or
find a shadow along the card's edge. A bad cut on a parcel already broken up cannot be undone by
re-scanning, so graphical repair exists **unconditionally**: detection quality decides how often it
is reached, never whether it exists. In #566 it is also where every box comes from.

It works in **rectangles** — not because stamps are rectangular, which triangles and diamonds are
not, but because a crop is. Draw, move, resize, delete, **split** one box that swallowed two touching
stamps, **merge** two that halved one. Nothing paints a mask or edits an outline.

**Nothing is created until the cut is committed**, so the whole review is free to be wrong.

Coordinates are the sheet's **original pixels** throughout, scaled for display by one measured
factor. That is what `extract` wants, it survives the window being resized mid-cut, and a box means
the same number on screen and in the database.

Reading order — rows by top edge within a tolerance taken from the **median** box height, each row
left to right — is computed in the editor and drawn in each box, so the numbers on screen are the
positions the tiles will actually be created with. The median rather than the maximum because a block
of four beside small definitives would otherwise swallow two rows of them into one.

### 7. Everything downstream is indifferent to where a box came from

#574 replaces hand-drawing with a proposal and changes nothing else: the boxes land in this editor
and are corrected exactly as hand-drawn ones are. The geometry lives in one pure module
(`src/lib/scan-boxes.ts`) that neither half owns, and no function below it asks how a box was made.

## Schema

| Table | What it holds |
| --- | --- |
| `scan_sheet` | A retained card scan: **collection**, optional purchase (#725), `batchNo`, an optional `label` (#587), `side`, storage key + mime, original and `view` dimensions, size. Unique on `(purchaseId, batchNo, side)`, plus a partial unique on `(collectionId, batchNo, side) WHERE purchaseId IS NULL`. |
| `scan_tile` | One region of one cut: **collection**, optional purchase, `batchNo`, `position`, `state`, the front and back boxes with the sheets they were drawn on, an optional note. CHECK: at least one side. Sheet FKs are `Restrict`. |
| `photo.tileId` | Fourth owner. CHECK widened to `num_nonnulls(itemId, stampId, offerId, tileId) = 1`; partial unique `(tileId, role)`. |
| `purchase.nextScanBatchNo` | Per-**purchase** batch sequence (#586). Not per lot, where the number named nothing. |
| `collection.nextScanBatchNo` | The twin of it for cards scanned outside any order (#725). |

Both owner columns started as `lotId` and were moved by #586, existing rows migrating through their
lot's purchase. The migration **renumbers**: numbers were unique per lot, so two lots of one order
could both hold a batch 1 and the new unique would collide. Sheets and tiles are renumbered from one
map, since a tile finds its sheets through `(purchase, batchNo)` and nothing else.

The boxes are kept though nothing needs them to *serve* a tile — they are what lets a re-cut reopen
the editor on the previous cut instead of an empty canvas, which on a card of forty is the difference
between correcting a cut and drawing one again.

## Consequences

- Re-cutting is **refused once a tile has been consumed**. #567 gives a copy the tile's very `Photo`
  rows, so deleting the tile would take a copy's front and back with it. The guard is written now,
  before the state that triggers it exists, because a guard added afterwards is one that was once
  missing.
- Replacing a scan is allowed only while nothing has been cut from it: the tiles' boxes were drawn
  over those pixels, and a replacement would leave them describing an image that is no longer there.
- A back scan of the **wrong card** with the same number of stamps in roughly the same places will
  pair silently. Mutual-nearest with no distance cap cannot tell that apart from a card laid out
  again, and a cap tight enough to catch it would break the case it exists for. The count report is
  the only signal, and it is one the collector reads rather than one the system acts on. Since #647
  an unequal count is acted on — nothing pairs — but an equal one is still only a count, so this
  case stands.
- Pairing a sparse back sheet is **a drag per stamp** (#647), including the card where the positions
  *were* reproduced and only some stamps were turned. That is the accepted cost of not pairing
  across gaps: the fast path is bought with a signal that cannot be subtly wrong, and unpairing
  (#648) is what makes the alternative — pairing optimistically and correcting afterwards —
  unnecessary rather than merely survivable.
- Colour correction stays in Photoshop and is deliberately out of scope. Sheet scanning already drops
  it from once per stamp to once per card, which is the whole win. If it is ever built it must not
  port Camera Raw's numbers (*Blacks 2012*, *Texture*, *Clarity*, *Vibrance* are proprietary and not
  reproducible in `sharp` — vibrance especially, which has no equivalent), and sharpening would have
  to run **after** each tile is downscaled or the resize eats it.
- **Interlocking perforations are an information limit no tuning can cross.** Where two stamps abut
  teeth into teeth the seam is white paper against white paper. The fix is physical — leave about one
  perforation tooth of gap when laying out the card — and it is in the user guide because it is the
  difference between a clean pass and hand-drawing boxes.
- What is joined stays one region. A se-tenant pair, a block, a strip: attached, so one region, one
  tile, and — once identified (#567) — **one copy with a format** (ADR-0020), never several singles.

## What #567 added

Identification (#567) needed **two columns and no new table**, which is the clearest measure of
decisions 1 and 2 having been right. A tile reaches one of three ends — a new copy, a copy already
on the lot, or a discard — and in all three the images move by `UPDATE photo SET "itemId" = …,
"tileId" = NULL`.

- `scan_tile.itemId` (`SET NULL`) — what a `consumed` tile became. Without it a consumed tile is a
  blank square on the card with nothing to say about itself, and "this stamp was on no line of the
  auction description" is a question the data cannot answer. `SET NULL` because deleting a copy must
  not delete the record that a tile was worked through; the tile stays `consumed`, since its images
  left with the copy and there is nothing to go back to.
- `scan_sheet.batchDoneAt` — the moment the **last** tile of a batch left `unidentified`. From then
  the batch can never be re-cut, so its retained original has no remaining function. Nothing in #567
  reads it; #578's retention sweep does. It is **cleared** when a discard is put back or a batch is
  re-cut, so the sweep never counts down on a batch still being worked.

Two smaller calls follow from the same place. Assigning a tile to an existing copy and discarding one
are allowed on a **closed** lot, while creating a copy is not: closing froze the money (ADR-0009 §3),
and a photograph is not money. And the intake dialog entered from a tile drops its photo uploader —
front and back are singleton slots per copy, so an upload arriving beside the tile's crop would be a
second front for the same copy.

### The tile dialog opens on an outcome, not on a menu of them

A tile's dialog exists for one reason the intake step cannot serve: it shows **both sides at a size
where a bad crop or an unidentifiable piece is visible**. That is what reviewing tiles is, as opposed
to trusting the cut.

What it must not do is spend a screen asking which of three answers is wanted. So it arrives already
showing one, with the remaining two in the footer, one click from wherever it opened. A chooser in
front of that is a screen whose entire content is three buttons, and a card of forty is forty of them
showing nothing.

Which one it opens on is **derived from whether there is anything this tile can be assigned to**, not
from where the lot came from. So a non-empty list *is* the signal: every line of a freshly settled
auction lot, the two hand-entered copies on a stockbook lot, and nothing once they have all been
photographed. That is right in both places a `fromAuction` flag was wrong, and the flag survives only
to word the sentence about lines that were described.

**The list asks exactly what the write asks.** `front` and `back` are singleton roles per copy, so an
assignment works only if the copy holds *none of the roles the tile carries* — a front-only tile onto
a copy with no front, a back-only tile (the unpaired-back case) onto a copy with no back, a paired
tile onto a copy with neither. The rule lives in one pure module (`tile-photo-roles.ts`) that the
refusal and the query fragment both read, because they drifted once: the list asked the weaker *"has
any free slot"*, offered a front-only tile copies that merely lacked a back, and the write then
refused them. **A list that offers what the write refuses is the defect** — the write was right. It
is deliberately not `no-photos` either: a copy with a back and no front can take a front-only tile.

The consequence is that the list is empty more often, and the derived mode lands on *identify* more
often. That is the correct answer for a tile that can go onto nothing, not a reason to loosen the
filter back.

The query is keyed by **lot**, so it is one fetch per card and cache for every tile after the first —
and the dialog **settles once and never jumps**: on the first tile it waits for the answer rather than
opening on identify and switching under the hand of someone already reading it.

### The strip is a map of the card, so a worked tile keeps its square and its picture

Position *n* in the strip is position *n* on the stockbook, and that correspondence is what lets a
tile be matched to the piece in the tweezers. Tiles therefore never disappear or renumber as work
proceeds — narrowing to what is left belongs to the *N tiles unidentified* chip and the per-batch
*N waiting* count, not to the layout.

A consumed tile draws **its copy's front**, which is the tile's own `Photo` row under its new owner:
consuming reassigns one column, so the picture never went anywhere and there is nothing to restore.
Drawing an empty placeholder there — as the first cut of this did — made the tile that went perfectly
well look more broken than the one that became nothing, which is the states read backwards. The
single honest placeholder is a consumed tile whose **copy was later deleted** (`itemId` is `SET
NULL`): its images left with the copy, and the square says that in words.

**Discard acts immediately and asks for nothing.** On a parcel full of junk it is the frequent
answer, and a note form standing in front of it would make the cheap outcome the expensive one — the
way a queue stops being worked through. The note is optional and written afterwards from the settled
view, on the rare tile whose reason will not be remembered. This is safe precisely because the
discard is reversible: *Put back in the queue* is in the same dialog, and an empty note is stored as
no note rather than as an empty string.

## What #579 added: the review can only be trusted if it can be looked into

Decision 6 said the editor exists because a bad cut on a broken-up parcel cannot be undone. It did
not say how a bad cut is *seen*. The likeliest one is the quietest — a box clipping a stamp's
perforation by a few pixels — and at fit-to-window on a whole card it is invisible. #574's reference
implementation says exactly this of its own verification: done by eye on contact sheets, "a box
clipping perforation by a few px would not have been caught". So zoom is not comfort work; it is
what lets the review answer the question it exists for.

Two calls follow, and both are about not lying to the collector.

**1:1 means one screen pixel per *sheet* pixel.** The editor displays the `view` derivative, capped
at `FULL_MAX_EDGE` against a 600 dpi card's ~7000 px, so a control that meant one *view* pixel would
read `1:1` while showing a threefold downscale — misreporting the very thing it is there for.

**Past the view's own scale, the visible region is served from the retained original.** Zooming the
derivative alone magnifies that downscale: a larger blur rather than more stamp. It is one `extract`
on bytes that decision 3 already keeps, and it is what they are kept for. Below that threshold the
view is still what is shown, because a browser cannot be handed a 30 Mpx image.

The region is a **sibling route** (`/scan-sheets/[sheetId]/region`) rather than a parameter on the
variant route. That route hands back an object that exists in storage — it takes the redirect fork a
GCS binding needs, and its `immutable` header is true because a sheet's bytes are written once under
a key never rewritten. A region is computed per request, so there is no URL to redirect to; folding
it in would have meant one variant value skipping the redirect fork, which is the sort of quiet
exception that later serves a signed URL for a crop nobody uploaded. Requests are debounced and
snapped to a grid of sheet pixels, because each one costs a full decode of the original server-side
and a pan would otherwise ask for a new nearly-identical crop every frame.

The transform is a **view** transform and nothing else: boxes are whole sheet pixels at every zoom,
exactly as before. The arithmetic lives in a third pure module (`src/lib/scan-viewport.ts`) that
neither the editor nor the route owns — the client decides which crop is on screen and the server
validates it, and a number that means different things on the two sides of that line is a crop of
somewhere else. Its one conversion back towards the sheet is fractional by design and always passes
through `normalizeBox`, which rounds; rounding earlier would quantise the gesture to whole sheet
pixels — at 8× zoom, one pixel of stamp per eight of mouse — without changing what gets stored.

## Consequences of the second half

- **A re-cut still destroys discarded tiles.** Only `consumed` refuses it, and that asymmetry is
  deliberate: re-cutting means the card is being drawn again, discards included. But a discarded tile
  is the only record of what a sight-unseen parcel held, so the confirmation names how many are about
  to go rather than taking them quietly.
- **A tile that matches no auction line is derived, never flagged.** It is recomputed from the copy's
  stamp against the lot's `AuctionLotLine` rows, so correcting a mis-identification corrects the
  signal too. A lot with no lines at all says nothing about any tile, rather than calling all of them
  undescribed.

## What #574 added: the boxes arrive proposed, and one constant did not transfer

Decision 7 said everything downstream is indifferent to where a box came from. #574 is the test of
that claim, and it passed: detection is one function (`src/lib/scan-detect.ts`) and one call
(`proposeCut`) that hands `Box[]` to the editor. `commitCut`, the pairing, the tiles and #567 are
unchanged, and the editor cannot tell a proposed box from a drawn one.

**Detection proposes; it never decides.** `proposeCutAction` answers with *no boxes* rather than an
error, so a scan it could not read opens the editor on an empty card — which is precisely the
surface #566 shipped. The manual path is not a fallback that detection might one day retire; it is
the primitive detection stands on, and its guarantee is unconditional.

### The algorithm, and the constant that had to move

The method is a port of a Python/SciPy implementation validated over ~1,450 photos: estimate the
background **per image from the border ring**, keeping several dark colour clusters on purpose;
threshold on **L∞ distance from the nearest cluster**, never on brightness; close, fill holes, open,
fill holes; erode with an L1 diamond to separate pieces touching along a line, label 4-connected,
and give the eroded pixels back to each bounding box. No fill-ratio, no aspect-ratio, no maximum
area, and no filter for reference slips.

Four of its constants were expected to need refitting for a card of dozens rather than a photo of
1–8 stamps, and did: the working resolution (900 → 2600 px), the erosion radius, the minimum area
(now stated in **mm² of card**, from the scan's own density) and the reading-order tolerance — the
last of which already lived in `scan-boxes.ts` from #566, taken from the median.

**A fifth had to move for a reason the issue did not anticipate, and it is the interesting one.**
The threshold floor went from 28 to 52, because a **1200 dpi flatbed resolves the stockbook card
itself** — the ridges its rows are creased along, its weave, its loose fibres — where a phone
photograph of a few stamps did not. At 28 a crease running under a row of stamps was foreground; it
joined their bottom edges, the row became a closed ring, and the hole fill then took the gaps
*between* the stamps as interior. A row of six came out as one box. That is not the perforation
limit and no erosion undid it: eroding hard enough to break the crease broke single stamps first.

The lesson generalises past this constant: **the reference corpus differed from a stockbook card in
its subject and in its instrument**, and only the second was invisible in the spec.

The whole-frame escape (`mean(mask) > 0.90` → one box) was dropped as the issue asked, and
`2026-08-14-0005.jpg` is the evidence: a souvenir sheet filling a card reads 81% coverage and
returns one correct box, while on a dense card the escape's failure would have been the entire card
as a single tile.

### Measured, not asserted

Eight real 1200 dpi cards, 120 physical pieces, held in a **gitignored** `tests/fixtures/scans/`
with a committed expectations file beside them; the harness skips entirely when the folder is
absent. **2 pieces of 120 need a hand — 1.7%**, against the reference's ~1.6% of stamps. Both
misses are the documented limits rather than tuning failures: one pair of definitives whose
perforations interlock came out as one box, and one stamp-plus-coupon came out as two.

Two things about that figure are stated rather than glossed. A count is a **lower bound** — two
errors that cancel read as zero — so placement was checked by rendering the boxes over every card
and looking at them; what that in turn cannot catch is a box clipping perforation by a few pixels,
which is exactly what #579's zoom exists for. And the set has **named gaps**, recorded in the
expectations file and printed by every run: stamps laid deliberately touching, a card with uneven
lighting, a non-rectangular stamp, and a front/back pair.

The physical rule follows from all of this and is in the user guide: **leave about one perforation
tooth of gap between stamps when laying out the card.** It is the one input to detection quality
that is entirely in the collector's hands.

## What #585 added: the same viewport over a tile, which is where the detail was all along

#579 justified zoom by the *cut*. The larger prize was one step later. Deciding **which variant** a
stamp is comes down to perforation teeth, a watermark, a plate flaw or a shade — work done with a
loupe over the physical piece, *after* it has been scanned at 1200 dpi, where all of that detail was
already sitting unlooked-at while the dialog showed it at the size of a postage stamp. So the tile
became the dialog: large, zoomable, pannable, with the outcome beside it.

It is a **second caller, not a second implementation.** `scan-viewport.ts` was written for the cut
editor but is about a picture and a viewport, and a tile is a rectangle of the very same card — its
size in *scan* pixels is the tile's own box, so `1:1` keeps meaning one screen pixel per scan pixel
without a single new number. Two things were generalised **in place** rather than forked:

- `regionOnSheet` — a viewport speaks its own picture's pixels, the region route speaks the sheet's,
  and the two differ by the tile's corner. The translation belongs beside the arithmetic it belongs
  to, for the reason the module exists at all.
- `regionRequest` now answers **null when the derivative is not a downscale.** A single stamp's tile
  is ~1400 px against a `FULL_MAX_EDGE` of 2500, so its photo already carries every pixel the scan
  has of it; asking for a region would cost a full decode of a 30 Mpx original to hand back what is
  already on screen. Stating it once, where the escalation is decided, beats every caller deciding
  whether it has a deeper source worth asking — and it was quietly true of a small card in the editor
  too.

The effects around that call were **shared rather than copied** (`use-sheet-region.ts`): the debounce,
the preload-before-swap and the drop-a-late-load guard are as particular as the arithmetic, and a
second copy of them is a second set of ways to paint a stale crop over a stamp.

Two product calls decide whether this actually replaces a loupe. **Switching front to back keeps the
zoom and the pan** — telling a variant apart is a comparison, and being thrown back to fit on every
flip is what makes a comparison expensive; the scale being in scan pixels is what makes that exact
rather than approximate across two crops of one card. And **1:1 is measured against the scan**, as in
the editor: a control that lied about it would be worse than none here, the whole question being what
is real detail and what is enlargement.

**What #578 leaves is the fallback, and it is testable now.** A swept sheet keeps its row and loses
its bytes, and both scan routes answer 404 deliberately — so the deep source is *known* to be absent
rather than discovered by a failed fetch. `scan-tile-view.ts` decides which sides a tile has and
which of them still have a card behind them, pure and away from the DOM, so the swept case is a unit
test rather than a screen reached by waiting for a cron job. A `consumed` tile is deliberately in the
same case: its pictures are read through the copy that owns them now, that copy's front can have been
replaced from the Copies screen, and nothing on the tile would say so — a sharp crop of the card
painted over a photograph of something else is the one failure this escalation must not have, and by
then the close look is over anyway.

## Still open

- ~~The batch has no name of its own.~~ **Settled by #587**, alongside the re-parenting above and in
  the same commit, both rewriting `scan_sheet`.

  An optional short `label`, editable **at upload and afterwards** — the second half being the one
  that matters, since a card often turns out to need naming only once a parcel has been left half
  worked for a week and the strip of thumbnails is the only thing telling one card from another. It
  is drawn beside the number wherever a batch is named, including #583's collapsed line, which is
  the whole of a finished batch and therefore exactly the case the name exists for.

  **The number stays primary.** It is assigned rather than chosen and it is what makes a batch
  findable, so the name is a gloss on it and never a replacement: two cards both called *Polska* must
  still be tellable apart. The rule lives in the pure `scan-batch-label.ts` because both halves read
  it — the write enforces the ceiling and the input states it — and a `server-only` module cannot be
  where a client component gets a constant from.

  It is a column on `scan_sheet`, written to **both** sheets of a batch exactly as `batchDoneAt` is,
  rather than a `scan_batch` table: a batch is already "the rows sharing a purchase and a batch
  number", and a third entity holding one nullable string would be a second place for a batch to
  exist. Writing both sides is also what stops re-scanning a named card's front leaving it nameless.
- ~~Nothing prunes a sheet once every tile cut from it has been consumed.~~ **Settled by #578**, and
  not in the direction the question implied. The pruning exists — `purgeFinishedScanSheets` reads
  `batchDoneAt` (#567), takes a finished batch's scans after the collection's retention period, and
  states that period beside the storage figure the scans dominate — but it is **off unless the
  collector asks for it**, where the closed-offer photo sweep it copies is on by default.

  That difference is the whole of the answer. #512's invariant is *generated bytes are the only bytes
  deleted on a schedule*, resting on #137's line: **output is disposable, a source is not.** A
  collage is rendered again from the copies' scans; a card scan is the source, and a stockbook cannot
  be re-scanned once it has been broken up. Deleting one on a timer on an instance whose owner never
  opened Settings would break a stated rule rather than merely be aggressive — so the capability
  ships and the schedule does not, and the invariant gains one clause instead of losing its force.

  What the sweep does when it *is* asked for follows the cautious call above rather than replacing
  it: the bytes go and **the row stays**, marked purged, so a re-cut refuses with *the scan has been
  deleted* and the batch still lists what the card held. The refusal earns its place on exactly one
  case — the batch whose tiles were **all discarded**, which is the only one a consumed tile is not
  already refusing for.

## What #725 added: the owner is the collection, and the purchase is optional

The same pass — scan a card, cut it, pair the backs, identify each piece — is worth exactly as much
on **stamps already owned**: a shelf being digitised, a gift, an inheritance. None of that is a
purchase, and inventing one to reach the flow would have put a fictional order in the Purchases list
and in every ROI figure that reads it.

**So the owner moved up.** `scan_sheet`, `scan_tile` and `scan_upload` carry a NOT NULL
`collectionId` and a **nullable** `purchaseId`; existing rows were backfilled through their purchase,
so nothing that already existed changed meaning. Every read scopes by the pair, and
`{ collectionId, purchaseId: null }` is not "any card in the collection" but exactly the ones with no
order — which is what makes one query serve two screens. Decision 1 is unchanged in substance: a tile
is still its own entity and still not an `Item`; what moved is only which row it hangs off.

**Two batch counters, not one.** `collection.nextScanBatchNo` numbers the purchase-less cards
alongside `purchase.nextScanBatchNo`. Merging them into one per-collection sequence is tidier and was
rejected: the migration would renumber every existing order's batches, and a batch number is written
on a physical card. That is the same rule #268 and #432 state about copy and purchase numbers — a
number a collector has quoted must not later mean something else.

**The lot question disappears rather than being answered.** `intakeStamps` takes
`{ lotId } | { collectionId }`, and with no lot the copy is created with a null `lotId`, a null
`costBasis` and `deliveryState = delivered`. All three are shapes the app already had — it is what
*Add copy* has always written — so nothing downstream needed an exclusion. Being lot-less also means
the copy takes no part in any pool split, which is decision 1's argument arriving at the same place
from the other direction.

**Assigning widens to the collection.** *Assign this tile to a copy that already exists* narrows to
the parcel on an order (#586) because a settled auction's card is matched against that parcel's
described lines. A card with no parcel has nothing to narrow to, so it offers the collection's copies
with the slot the tile needs still free — the same sentence one level up, not a relaxation of it.
While digitising a shelf that is the common case: most pieces are already recorded and want
photographs rather than identification.

**Cards with an order and cards without are two lists, deliberately.** A parcel's cards stay on the
order's screen, where the lot question and the auction assign path live; the purchase-less ones get
their own screen under Inventory. One combined list would have had to explain, per row, which of two
identification flows a tile is about.
