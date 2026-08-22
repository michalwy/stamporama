# ADR-0040: An Area's Catalog Configuration — Numbering Apart From Pricing, and a Prefix at Two Levels

## Status

Accepted. Extends ADR-0020's *where outranks for which* to the catalog prefix.

## Context

Setting a catalog up on an area was the slowest recurring configuration in the app, and the reason
was a surface that mixed two unrelated questions.

The schema had them apart from the beginning. `CatalogVendor` owns **numbering** —
`StampCatalogNumber`, `IssueCatalogNumber`, prefixes — and `CatalogName` owns **pricing** — a
currency, `CatalogEdition`, `StampCatalogPrice`. `CollectionAreaVendor` and `CollectionAreaCatalog`
are the two links an area declares them through. But the area dialog presented one list keyed by
*book*, with a prefix box on every row, and the vendor rows were **derived at save time** from the
books. Three consequences, all of them felt on every new area:

1. **The same prefix was typed once per vendor.** `PL` for Michel, for Stanley Gibbons, for Yvert,
   for Fischer — because there was no prefix at the area level at all, only per (area, vendor).
2. **Two books of one vendor fought over one stored value.** *Michel Deutschland* and *Michel
   Deutschland Spezial* rendered two prefix boxes backed by one `CollectionAreaVendor` row, and
   `syncAreaCatalogEntries` collapsed them with "non-null wins, else last wins" — one of the two
   typed values was silently discarded.
3. **A vendor could not exist without a book.** Recording Michel numbers in an area you own no
   Michel volume for is an ordinary situation, and attaching a book was the only way to obtain a
   vendor, so it was inexpressible.

A fourth was hiding behind them. Three server paths resolve which books price an area, and only one
walked the area tree: the trade's agreed catalog (#638) inherited, while the variant price grid and
the stamp catalog-prices tab read the area's own rows and nothing else. So a leaf — the level
material is actually filed at — offered no editions at all unless the same books were re-attached
to it.

## Decision

### 1. The two declarations are written separately

`CollectionAreaVendor` becomes a **written** table, not a derived one: `syncAreaVendors` writes the
numbering vendors and `syncAreaCatalogBooks` writes the price books, and neither infers the other. A
vendor row may exist with no book behind it. The area dialog is two sections rather than one list —
*Numbering* (the area prefix, then one row per vendor) and *Price sources* (the books) — which is
what makes the separation visible rather than merely true in the schema.

The dialog still **ticks a vendor by default from the books the area attaches**. That is the old
derivation kept as a default, which is all it was ever good for.

### 2. The prefix lives at two levels, resolved by one walk

`CollectionArea.catalogPrefix` is the area's prefix for *every* vendor.
`CollectionAreaVendor.areaPrefix` stays as the per-vendor exception. Resolving a (area, vendor) pair
is:

1. the issue's override (`IssueCatalogPrefix`, #377) — unchanged;
2. otherwise walk up the area tree and stop at the **first area that states a prefix** — a vendor
   row for this vendor, or the area's own `catalogPrefix`;
3. within that one area, the vendor row wins;
4. nothing up the chain → no prefix.

This is `StampFormatFactor`'s rule (ADR-0020 §4): **where** outranks **for which**. Worked example —
Poland sets `catalogPrefix = PL` and a Fischer row with no prefix; child area GG sets
`catalogPrefix = GG` and says nothing about Fischer. Fischer under GG resolves to **`GG`**: the
nearer area decided, and repeating the Fischer exception on GG is how you keep it. One tree walk,
and "where did this prefix come from" always answers with the nearest ancestor.

The prefix is **catalog identity**, not a display layer (#66/#377), so the rule decides the rendered
chip, the picker's match keys, generated listing texts, derived offer-set and auction-lot names,
duplicate detection (#85) and the Colnect strict full-key match (#155) alike. It is implemented
twice — `resolveEffectivePrefix` reads Prisma rows on the server, `resolveAreaVendorPrefix` reads the
client's area payload — and the two are held to one shared table of cases, because a disagreement
between them is a stamp that reads as one thing and de-duplicates as another.

### 3. A vendor row carries three states

`areaPrefix` is `''` for the stated *no prefix for this vendor here*, NULL for the ordinary tick
whose prefix inherits, and text for that prefix. Two states could not express the ordinary tick:
ticking Mi, Sg, Yt and Fi on a Poland that had just been given `catalogPrefix = 'PL'` would write
four rows that each killed `PL` — the very typing the area prefix exists to remove.

Every row that existed before this decision meant the middle option, because a row was then the only
prefix level and the resolver stopped at any row it found; the migration rewrote those NULLs to `''`,
which changes no answer and leaves NULL free for what it now means. The collector clears the mark
where they want a lifted area prefix to reach down, and that is a deliberate, visible act in the new
section — the alternative, reading today's NULLs as "inherit", would have handed prefixes to areas
that never had one.

### 4. The primary splits in two

`primaryCatalogNameId` answered two unrelated questions: which book gives a copy its catalogue value
(`item-valuation.ts`) and, by derivation, which vendor leads numbering — the catalog sort key
(#181), the leading label, the primary chip. `CollectionArea.primaryCatalogVendorId` now holds the
numbering answer and `primaryCatalogNameId` keeps only the valuation one. Both inherit down the tree
from the nearest ancestor that sets one, as the primary always did.

They had to separate, or a vendor recorded without a book could never lead. A consequence worth
stating: the subtree sort-key recompute is gated on the **vendor** changing, so swapping which Michel
volume prices an area no longer triggers a recompute it cannot affect.

### 5. Price books inherit, as one list

`buildEffectiveAreaCatalogMap` is the single resolution: an area's books are its own, or — where it
attaches none — the nearest ancestor's. The unit that inherits is the **whole list**, not one book at
a time, which is the same shape as the prefix rule: an area that attaches a single Michel volume
states its price sources completely and does not silently keep an ancestor's Fischer. All three
readers go through it.

## Consequences

- Setting up a new leaf area is usually **nothing at all**: it inherits the prefix, both primaries
  and the whole book list from its parent. The Areas list marks each of those own-vs-inherited on the
  row, so a leaf says where its configuration comes from without being opened.
- Inherited values render as **placeholders** in the dialog (the issue dialog's idiom, #377), so
  clearing a field returns it to inheriting rather than storing a blank.
- `buildVendorCatalogMap` (#638) changed behaviour in one respect: it resolves off the effective book
  list, so an area that attaches books of its own no longer falls through to an ancestor for a vendor
  missing from them.
- Nothing was dropped. `collection_area_vendor` and `collection_area_catalog` both stay, and every
  (area, vendor) pair that had a prefix before the migration has the same one after — verified
  against a copy of the development database rather than by eye. The only pairs that moved are those
  for a vendor no book anywhere up the chain belongs to, which no surface resolves a prefix for.

## References

- Issue #675; ADR-0020 (format as an axis, and the *where outranks for which* precedence);
  #66/#377 (the prefix as catalog identity); #85 (duplicate detection); #155 (Colnect strict match);
  #181 (catalog sort key); #638 (a trade's agreed catalog).
- `prisma/migrations/20260822120000_area_catalog_prefix_and_primary_vendor`,
  `prisma/migrations/20260822130000_area_vendor_prefix_inherit_vs_none`.
