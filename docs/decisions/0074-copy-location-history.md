# ADR-0074: A Copy's Location History, Written by the Database

## Status

Accepted. Decided in #2277 on 2026-10-31, which built it; the *what* was settled with the collector
in the issue, the *how* below in building it. #2278 (packing or writing off a copy takes it off its
location) builds on it.

## Context

A copy's location was only ever its current one. Once it moved — by its form, Bulk edit, Store on a
purchase, a scan sheet, a replacement — where it was before was gone. A stocktake finding a card
short had nothing to say what was taken off it and when, and #2278 is about to take packed copies
off their locations, after which a stamp found missing from a parcel has to be looked for where it
was.

The collector settled that **every change of a copy's location is recorded**, including being taken
off with no new one, and that the record shows **on the copy** and **on the location**. The issue
adds: one entry per change, with when, the place left and the place reached (location and ref — the
ref is part of the place), and what did it; entries never edited or deleted; a starting entry for
every copy on the day this ships.

## Decision

### 1. One table of moves, `ItemLocationMove`

An entry names the copy, the collection, the instant, the location and ref it left (or none), the
location and ref it reached (or none), the **source** — `start`, `created`, `copy_form`, `bulk_edit`,
`purchase`, `scan`, `replacement`, `other` — and, where the source names something, its id
(`sourceId`: the purchase). `sourceId` is not a foreign key, because what it points at depends on
the source; a reader that cannot find the purchase shows the source unnamed.

Each end also keeps the **location's name as it was written**. The location is a foreign key with
`ON DELETE SET NULL` — a location is deleted only once empty, and refusing that because it has a
history would make every location undeletable — so after a delete the id is gone and the name is
what still says which box.

### 2. The database writes the entries

A trigger on `item` (`item_record_location_move`, in `20261031120000_item_location_moves`) adds an
entry **after every insert** and **after every update that changes `locationId` or `locationRef`**.
The app never inserts one.

The alternative was a helper every write path calls. There are a dozen such paths across
`items.ts`, `lots.ts`, `scan-tiles.ts`, `replacements.ts` and `auctions.ts`, several of them
`updateMany` over a scope the app never enumerates, and #2278 adds more. A helper is a promise each
of them, and each one written later, keeps; the trigger is the guarantee that *every change is
recorded* holds whatever code made it — which is what the collector asked for. The diff of old and
new is also the trigger's for free, where a helper would have to read every scoped row before the
write.

`clock_timestamp()`, not `now()`: one transaction can move a copy twice (added, then filed), and the
two entries have to keep their order. Stored in UTC, as every timestamp Prisma writes is.

### 3. The app says *what* moved the copy, through transaction-local settings

`setMoveSourceTx(tx, { source, sourceId })` (`src/lib/location-moves.ts`) runs
`set_config('stamporama.move_source', …, true)` inside the transaction that moves the copies, and
the trigger reads it. Transaction-local is the point: it ends with the transaction, so it can never
leak onto the next statement of a pooled connection — and it only means anything inside a
`$transaction`, which every path that moves copies already was or now is.

A write that sets none is **recorded, never refused**: `created` for an insert, `other` for an
update. Refusing would turn a forgotten annotation into a failed save for the collector; recording
it as *Other change* keeps the history whole and shows where an annotation is missing.

Which path says what: the copy form (create and edit) `copy_form`; the Copies list's Bulk edit
`bulk_edit`; everything on a purchase's own screen — Store, Move, a row's edit, the scoped bulk
changes, marking it arrived into a location — and copies added on a purchase (intake, scan
identification into a lot, a settled auction) `purchase` naming it; re-identifying a scan tile's
copy `scan`; filing old copies on Replacements `replacement`. A purchase id that arrives from the
client is kept only when it is this collection's.

### 4. The history starts with the migration

Every copy then gets one `start` entry naming where it was — filed or not, held or not — written
before the trigger exists so it is not recorded twice. So every copy has an entry to start from.

### 5. Read on the copy whole, on the location a page at a time

`getCopyLocationMoves` reads a copy's entries whole — a copy has few. `listLocationHistory` pages
newest first by cursor (`movedAt`, then `id`), because a location holds as many starting entries as
copies it held; it answers for the location **and everything under it**, matches a ref at the end of
the entry that is in the location (case aside), narrows by whole UTC days, and says per entry
whether it came **in**, went **out** or moved **within**.

### 6. A copy that leaves is taken off its location (#2278)

Amended by #2278, which the collector settled on 2026-10-31: a copy comes off its location — location
and ref both cleared — the moment it is **packed for a sale** (its own tick, *mark every copy packed*,
the phone), **packed for a trade** it is given away in (a give line recorded *sent* or *never
arrived*), or **written off**. The sources are `sale_packing` (naming the sale), `trade_packing`
(naming the trade) and `write_off`, written through `takeOffLocationTx` (`location-moves.ts`), which
names the source and clears the place in one transaction. Nothing puts a copy back — unpacked,
restored or returned, it is filed anew — so a location counts exactly the copies physically in it.

What reads the history because of it:

- **The packing lists** show a packed copy under the place it was taken from — its latest entry
  that took it off a location (`packedFromPlaces`) — so a stamp missing from the parcel can be looked
  for where it was.
- **The next ref** (`getLocationRefUsage`) follows every ref ever written in the location, the
  history's `toRef`s included, so a card emptied by packing is not numbered twice.

The copies already packed, sent, delivered, traded away or written off were taken off theirs by
`20261031140100_take_gone_copies_off_locations`, through the trigger, per sale and per trade so each
entry names its own. The new enum values are added by the migration before it: a value cannot be used
in the transaction that adds it.

## Consequences

- The schema has a second trigger and function beside `stamp_allocate_stamp_no` (ADR-0062); like it,
  they live in their migration and nowhere in `src/`, and `prisma migrate diff` does not see them.
- A new way of moving copies is recorded with no work; naming its source is one `setMoveSourceTx`
  call, and forgetting it shows as *Other change*, not as a gap.
- A raw `UPDATE "item"` from `psql` is recorded too, as `other` — which is what the record is for.
- The agent API neither moves copies nor reads the history; it is out of scope (#2277).
- #2278 added its sources (packing for a sale or a trade, a write-off) to the enum in its own
  migration, §6.
