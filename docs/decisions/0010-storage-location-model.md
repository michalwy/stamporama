# ADR-0010: Storage Location Data Model

## Status

Accepted

## Context

A collector's copies live somewhere physical — a cabinet, a stockbook, an album, a
box. As a collection grows, "where is this copy?" becomes a real question, and the
inventory needs to answer it: file a copy into a location, browse everything in a
given stockbook, and record a page/pocket reference within it.

This is deliberately **separate from catalog areas** (`CollectionArea`, ADR-0002):
an area is a taxonomy of *what a stamp is* (country, period), whereas a location is
*where a copy physically sits*. The two are orthogonal — copies from many areas share
one stockbook, and one area's stamps scatter across many locations. The model was
scoped in #55 and built in #56.

## Decisions

### 1. Location is a collection-scoped adjacency-list hierarchy

`Location` reuses the exact pattern of `CollectionArea`: collection-scoped, a nullable
self `parentId` for arbitrary-depth nesting, ordered by name. This keeps the tree
primitives (`buildTree`, tree-select, path breadcrumbs) shared rather than reinvented.

Fields: `id`, `collectionId`, `name` (required), `parentId?`, `description?`,
`assignable` (`Boolean`, default `true`), `createdAt`.

### 2. `assignable` separates grouping nodes from real storage

Storage is naturally two-level in spirit: a *cabinet* groups *stockbooks*. Rather than
a rigid type enum, a single `assignable` boolean marks whether a node can actually hold
copies. Grouping-only nodes (a cabinet) set `assignable = false`; leaf storage (a
stockbook) leaves it `true`. It defaults `true` so the common case — creating a place
to put things — needs no extra thought. A location cannot be flipped to non-assignable
while copies are filed in it.

### 3. A copy references at most one assignable location, plus a free-text ref

`Item` gains `locationId?` (one location per copy) and `locationRef?` (a free-text
identifier *within* the location, e.g. `p.12`). The ref is per-copy and **not unique** —
it is a human aid, not a key. Only `assignable = true` locations are valid targets,
enforced in `src/lib/items.ts`. `locationId` uses `onDelete: Restrict` so a stored copy
is never silently orphaned.

### 4. Delete is guarded, not cascaded

Deleting a location with child locations or stored copies is **blocked** in the domain
layer (mirroring `CollectionArea`) — the collector must move the contents first. The
self `parentId` FK is `SetNull` as a database backstop, but the guard means it never
fires in practice.

### 5. Location filter includes the subtree

Filtering the inventory by a location matches that location **and all its
descendants** ("show everything in Cabinet 1" includes every stockbook inside it). The
subtree is resolved server-side from one flat read of the collection's locations.

### 6. Every location has a short, stable code (#2191)

Added 2026-10-26. `Location.code` is up to six letters and digits, stored upper-cased and unique
within the collection (`@@unique([collectionId, code])`, which is the case-insensitive rule because
the value is normalized before it is written). It is a label standing in for the path where the
path is too long or too private to print — the packing list (#2192) — and is therefore **stable**:
a rename or a move keeps it, and only the collector changes it. A code is generated from the path
where none is typed (`src/lib/location-code.ts`; existing locations were backfilled by the same
rule in SQL). It is never part of `Item.locationRef`.

*Amended by §7: the code is now per level, and the stable whole-path code is gone.*

### 7. A location's code is its levels' codes joined with dots (#2235)

Settled with the collector on 2026-10-28. A whole code set on each location cannot follow the tree:
a structured scheme — cabinet `A`, its shelf `A.B`, the stockbook on it `A.B.C`, its first page
`A.B.C.1` — had to be typed out in full on every location and kept in step by hand, and six
characters without a dot did not fit it. So `Location.code` now holds **its own level's code
only**, and the location's **full code** is its ancestors' codes and its own joined with `.` from
the top down, built where it is shown (`buildLocationCode` in `src/lib/location-code.ts`, and
`LocationData.fullCode` from `getLocations`) — never stored, so a move or a parent's new code
changes the full code of the location and everything under it at once. That replaces §6's
*stable*: the code is meant to follow the tree.

A level's code is any text of any length, trimmed and otherwise kept as typed, with no dot in it
(the dot is the separator) and never blank. It is **unique among its siblings regardless of case**,
which is what keeps the full codes unique: the unique index is
`("collectionId", "parentId", lower("code")) NULLS NOT DISTINCT` — the nulls must be equal so the
top-level locations are siblings of each other — created by hand in
`20261028120000_location_level_codes`, since Prisma can express neither the expression nor the
null rule. A move is checked against the new siblings too, and a clash is refused naming the
sibling's path. A new location is offered a code from its own name by §6's rule applied to one
level (the initial of the last word, or that word whole when it is a number), numbered `A2`, `A3`…
past a sibling's; the migration recalculated every existing code the same way.

## Consequences

- Locations get their own screen under the **Collection** section (not Settings):
  unlike areas, storage is touched routinely as copies are filed and retrieved.
- The `Item` → storage link is a plain nullable FK; no join table is needed because a
  copy sits in exactly one place.
- Future work (bulk move, per-location holdings value, capacity hints) builds on this
  model without schema change.
