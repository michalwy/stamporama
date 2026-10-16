# ADR-0070: Replacement Pairs — a New Copy Replaces an Old One, Settled Card by Card

## Status

Accepted. Decided with the collector on 2026-10-15 and built by #1936, the foundation of a track:
#1937 records a pair while identifying a tile, #1938 records pairs from a review of the collection's
duplicates. Both only *record* pairs; everything about what a pair is and how it is settled is here.

## Context

Upgrading the collection — keeping a better copy and selling the one it replaces — was done by hand:
the new copy was kept *In collection*, and later the collector filtered the Copies list to the
collection, grouped by duplicates, found the stamps held twice, ticked the copy to let go, physically
moved it to the sale stock, and bulk-edited it to *For sale* with its new location. The decision was
made once, usually at identification, and then had to be rediscovered.

Two first ideas were wrong for the collector's physical workflow and are recorded so they are not
proposed again:

- **The new copy taking the old copy's place** (its location and ref). The new copy is filed at
  identification on its card in the *Unsorted* stock, one ref per card, and it stays there.
- **A fixed number of copies per sale card**, rolling over to the next ref when reached. How many
  stamps a card takes depends on their sizes; only the collector knows when a card is full.

## Decision

### 1. A replacement is a pair, and recording it moves nothing

`ItemReplacement` names a **new** copy and an **old** copy of the same collection. Recording a pair
changes neither copy. The new copy stays where it was filed; the old copy stays where it lies until
the pair is settled.

The pair is offered between copies of the **same stamp** (the picker lists the collection's other held
copies of the copy's stamp, those in the collection first). The domain does not insist on it: a pair
is the collector's statement, and nothing downstream reads the stamp off it.

### 2. Lifecycle: open → done | cancelled | moot

- **open** — recorded, waiting to be settled.
- **done** — settled (§4).
- **cancelled** — withdrawn by the collector. Neither copy is touched.
- **moot** — either copy left the collector's hands first: sold, traded away (the give line of a
  closed trade), disposed of, or deleted. The pair records *why* (`mootReason`) and *through which
  copy* (`mootSide`), and says so wherever it is shown: *Closed — #123 was sold*.

`closedAt` is set exactly when the pair leaves `open` (a CHECK says so). Only an open pair is ever
written again.

### 3. One open pair per old copy, enforced by the database

A copy is the old copy of at most one open pair — a partial unique index on `status = 'open'`. A
copy may be new in one pair and old in another (a chain of upgrades). Closed pairs are history and a
copy may collect any number of them.

*Amended by #1938:* as first built, a copy was also the new copy of at most one open pair. The
duplicate review breaks that by design — the copy kept out of three replaces the other two — so the
new side's index was dropped (`20261015220000_duplicate_review`). Nothing read the rule: a pair is
settled by its old copy alone.

### 4. Settling uses a current card

The Replacements screen asks once for the **current card**: an assignable location and its ref,
offered exactly as Store offers them (#629/#1334) — the card the location is up to by default, *Next
card* for the next blank one, and the *now · adding · after* figures (#1535). It stays set while the
collector works, and is **not remembered across visits**: *Done* writes without asking, so where it
writes must be something chosen on this visit (quick offer mode's rule, #537).

**Done** on a pair, or on several ticked pairs, sets each old copy's location and ref to the current
card, clears *In collection* and sets *For sale*, and closes the pair as done. Nothing else changes —
condition, photos, number, *For trade*, the new copy. There is no capacity: the collector presses
*Next card* when the physical card is full.

Open pairs are listed **in the order the old copies lie** — location path, then ref in walk order —
so the list is the round to take them out in.

### 5. Moot is detected on read, not hooked into every exit

A copy leaves the collection along four paths, and the sale path alone has a dozen writers (the
manual sale, every platform importer). Hooking each would be a hook the next importer forgets.
Instead every read and write of pairs first closes the open pairs one of whose copies has gone
(`closeMootReplacements`). What the screen shows is therefore always true, and a copy whose partner
was sold is free to be paired again before anything else is written.

### 6. History survives a deleted copy

Both copy references are `ON DELETE SET NULL`, and the pair carries both copies' numbers as written
when it was recorded. A deleted copy closes its pair as moot, and the other copy's history still names
it — a copy number is never reused (#268). The collection cascades.

### 7. Where pairs are recorded and read

- A copy's **⋮** on the Copies list: *Replaces…* and *Replaced by…*, on a copy still held that
  carries one stamp. The copy's own screen has no menu; it shows the copy's pairs in a read-only
  *Replacements* card (*Replaces #M* / *Replaced by #N*, with the status).
- **Identifying a scan tile** (#1937): *Replaces* in the identification step, over the stamp's copies
  in the collection, when one tile is identified as one stamp; and per row of a run. Choosing a copy
  ticks *In collection* on the new copy — since #1972, an icon beside the dispositions opening a
  picker of those copies as pictures, and the choice turns the other dispositions off. The copy to replace is checked before the copy is created
  (identification's whole-or-nothing rule, #596) and the pair is written once it exists.
- **Inventory → Replacements**: the open pairs with both copies' pictures and the old copy's place,
  the recently closed ones, *Done* and *Cancel*.
- **Review duplicates** on the same screen (#1938): the stamps held *In collection* more than once,
  counted as duplicate grouping counts them (#1932, *Split by …* switches included), with the area
  and condition filters. *Keep this* records each other copy as a pair replaced by the kept one;
  *Keep all* marks every copy (`DuplicateKeepAll`, one row per copy) and the stamp stays out of the
  review until an unmarked copy joins. A copy already the old copy of an open pair is shown with its
  stack and not offered again.

## Consequences

- Upgrading becomes two acts — record once, settle on a round — instead of a search repeated later.
- #1937 and #1938 add ways to record pairs; #1938 relaxed §3 on the new side and nothing else.
- A pair is not an agent API operation; none was asked for.
