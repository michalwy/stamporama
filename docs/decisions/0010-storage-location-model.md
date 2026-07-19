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

## Consequences

- Locations get their own screen under the **Collection** section (not Settings):
  unlike areas, storage is touched routinely as copies are filed and retrieved.
- The `Item` → storage link is a plain nullable FK; no join table is needed because a
  copy sits in exactly one place.
- Future work (bulk move, per-location holdings value, capacity hints) builds on this
  model without schema change.
