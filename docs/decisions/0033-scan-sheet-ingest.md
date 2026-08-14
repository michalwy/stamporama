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

### 1. A tile is its own entity; `Item` is not it

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

`ScanTile` therefore belongs to a `PurchaseLot` and carries where it came from, its position in
reading order, its batch, and its state (`unidentified` / `consumed` / `discarded`). Only the first
is reachable here; the other two are #567's.

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

An unmatched **back** becomes a **back-only tile**, shown in an unpaired strip and dragged onto a
front tile. That is the sparse case — backs scanned for only some stamps — handled with the same
entity and the same images rather than a third mode. Dropping it re-owns the `Photo` row and deletes
the emptied tile.

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
| `scan_sheet` | A retained card scan: lot, `batchNo`, `side`, storage key + mime, original and `view` dimensions, size. Unique on `(lotId, batchNo, side)`. |
| `scan_tile` | One region of one cut: lot, `batchNo`, `position`, `state`, the front and back boxes with the sheets they were drawn on, an optional note. CHECK: at least one side. Sheet FKs are `Restrict`. |
| `photo.tileId` | Fourth owner. CHECK widened to `num_nonnulls(itemId, stampId, offerId, tileId) = 1`; partial unique `(tileId, role)`. |
| `purchase_lot.nextScanBatchNo` | Per-lot batch sequence. Per lot, not per collection: a batch number is only ever read beside its lot. |

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
  the only signal, and it is one the collector reads rather than one the system acts on.
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

## Consequences of the second half

- **A re-cut still destroys discarded tiles.** Only `consumed` refuses it, and that asymmetry is
  deliberate: re-cutting means the card is being drawn again, discards included. But a discarded tile
  is the only record of what a sight-unseen parcel held, so the confirmation names how many are about
  to go rather than taking them quietly.
- **A tile that matches no auction line is derived, never flagged.** It is recomputed from the copy's
  stamp against the lot's `AuctionLotLine` rows, so correcting a mis-identification corrects the
  signal too. A lot with no lines at all says nothing about any tile, rather than calling all of them
  undescribed.

## Still open

- The batch has no name of its own. A lot with six cards is *batch 1…6*, which is enough while a card
  is worked through immediately after being scanned and may not be later.
- Nothing prunes a sheet once every tile cut from it has been consumed. Keeping it is the cautious
  call and matches "the scan is what makes a re-cut possible", but a collection that ingests by scan
  for a year will hold a great many originals it can no longer re-cut anything into. #567 records
  *when* each batch became prunable (`batchDoneAt`); #578 is what acts on it.
