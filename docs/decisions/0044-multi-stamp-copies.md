# ADR-0044: A Copy That Carries Several Stamps

## Status

Accepted, not yet implemented. The work is tracked in #744 (schema), #745 (the exclusion rule),
#746 (the editor), #747 (valuation), #748 (the list), #749 (listing tokens) and #750 (intake).

## Context

A copy is one stamp: `Item` carries `stampId`, a condition, a certificate status and a format
(ADR-0007). That is right for loose material, and the model already answers two of the three ways a
single piece of paper can hold more than one stamp:

- **A homogeneous multiple** — a pair, a strip, a block — is one copy in one **format**
  (ADR-0020). It is never decomposed and never counted as N singles.
- **A se-tenant combination the catalogue numbered itself** — Michel `S`/`W`/`K`/`Zd` — is its own
  `Stamp` (ADR-0020 §4). The test is whether the catalogue gave the thing a number, not whether it
  holds more than one stamp.

The third way has no answer: an **indivisible carrier bearing several different catalogue
positions**, which the catalogue never numbered as a whole. A cover franked with three different
stamps, a fragment cut from a parcel card, an FDC. The collector cannot take these apart, and would
not want to.

Filing such a piece under one of its stamps is not merely lossy — it makes the collection **assert
something false**. It says the collection holds Mi 200, available to sell, when Mi 200 is glued to a
cover that will be sold whole. The want for Mi 200 would close, the duplicate detector would report
a duplicate, and the completeness figure would count a position the collector cannot supply.

Format cannot be stretched to cover it either. Format answers *what this copy physically is* about
**one** stamp; it has no way to name a second catalogue position, and a price grid keyed
`stamp × condition × certificate × format` has nothing to resolve for a franking of three.

## Decisions

### 1. One `Item` is one physical thing

A carrier is a single copy. Nothing is decomposed into N copies, exactly as ADR-0020 §2 refuses to
decompose a block of four.

The alternative — a parent entity owning N ordinary copies flagged indivisible — was rejected on the
same reasoning and on a second one: `itemNo`, location, cost basis, photos, offers, sale lines and
trade lines all hang off `Item` and all describe the *thing that is sold*. Splitting a cover into
three copies would force each of those to answer "which of the three?", and every answer would be an
invention.

### 2. `ItemStamp` holds every stamp; `Item.stampId` becomes a pointer

The new join carries **all** of the carrier's stamps, the leading one included, with `quantity`,
`sortOrder` and an optional per-entry `formatId`.

`Item.stampId` is kept and is **denormalised**: it points at the first entry. Two reasons, and the
first is decisive:

- 171 files under `src/` read `Item.stampId`. Making it nullable is a rewrite of the app, not a
  migration, and there is no product question behind it.
- With every stamp in one table, "which pieces carry Mi 200" is one query. Had the leading stamp
  lived only on `Item` and the rest in the join, the question would have to be asked in two places,
  and the two places could come to disagree.

What the pointer **stops** meaning is the assertion "this copy is that stamp". That is §3.

### 3. More than one stamp, and it is a copy of none of them

The central rule, and it is symmetric: the leading stamp is excluded on exactly the same terms as
the others. A carrier's stamps are a **description** — searchable, listed on the piece's own screen,
enumerated in listing text — and never a claim of ownership.

The rule is *not* about indivisibility. A cover bearing one stamp is equally indivisible, and it is
correctly counted as a copy of that stamp on cover: catalogues price exactly that (Michel's *Brief*),
and §4 makes it resolve. The rule is about **unambiguity**. While a carrier holds one catalogue
position it *is* that position, in the shape "on cover". Holding several, it is none of them in
particular.

Consequently the copy drops out of copy counts, checklists, completeness, wants, duplicate-catalogue
detection (#85) and auction duplicates, and out of the Colnect list-sync source predicates. It stays
fully a copy for everything that is about the object rather than the catalogue position: offers,
sales, trades, location, disposal, delivery, cost basis, photos, `itemNo`.

**Colnect files it nowhere rather than under `not-comparable`.** That bucket means "carries no
`colnectId` yet" — a backfill to-do (#250). A multi-stamp copy is outside the question permanently
and would sit in a task list yielding no task, so it drops out of `items_in_collection` and its
siblings the way a sold or disposed copy does.

### 4. The count is materialised, and counts described components

`Item.stampCount` is the summed `quantity` of the entries, written whenever they change.

Materialised because §3 has to be enforced in `heldCopiesWhere` and half a dozen counterparts, and
three queries answering "how much of this do I have" must not be able to disagree — the reason
`copy-counts.ts` already routes them through one predicate. A flat column keeps every one of them a
plain `where`, beside `disposedAt: null`.

**`quantity` counts described components, not sheets of paper**, and the boundary with ADR-0020 §2
is why. That section states that a format carries no unit count and that nothing anywhere multiplies
or divides by one. So a block of four on a cover is **one** component of quantity 1 whose
`formatId` is `Blk4` — not four — and the piece remains an unambiguous copy of that stamp under §3.
A cover bearing Mi 200 twice, loose, is one entry of quantity 2 and is excluded. Reading the block
as "four" would require inventing a unit count for formats, which ADR-0020 §2 exists to refuse.

### 5. The carrier type is a `StampFormat`

"Cover", "Piece", "FDC" are rows in the existing per-collection format dictionary, beside "Block of
4". No second dictionary.

`Item.formatId` keeps the single meaning it has always had — *what this physical thing is* — and a
cover is what the thing is as much as a block is. Reusing it means the filters, the `{format}` and
`{formatAbbr}` tokens (#345), the translations (#344) and the `as` switcher (#343) all reach carrier
types on the day they are added. It also makes a **one-stamp cover** resolve its price through
ADR-0020 §5 with nothing new built, which is what catalogues actually publish.

The one thing a single column cannot say is a thing that is both. So **`ItemStamp.formatId`
describes the component** — a block of four *on* this cover — with null meaning single, the ADR-0020
§3 idiom. For a copy that is not a carrier the entry's format stays null, because the copy's own
`formatId` already describes it.

### 6. The value is explicit; the sum is a suggestion

The catalogue grid resolves nothing for a multi-stamp copy — by §3 it is not a copy of any of its
stamps — so the piece would be unpriced for ever, and covers are usually the interesting material.

The value is therefore recorded on the copy. The **sum of the components is offered as a prefill in
the Valuation dialog and is never stored on its own**: ADR-0020 §5's "explicit or derived", with the
derived half asking for one click. The click is the point. A cover's worth is a question of usage
and franking, not the arithmetic of its stamps, and a figure that appeared in the collection's
totals without anyone judging it would be a claim the app invented.

The suggestion values each component at the **copy's** condition, at the **entry's** format, with
**no certificate** — a certificate is a statement about the piece, not about each franking — times
the entry's `quantity`. A component that resolves to nothing leaves the suggestion visibly partial
rather than contributing zero, for the reason ADR-0020 §9 leaves a copy unpriced rather than falling
back to a different thing's price.

### 7. One inventory list

Multi-stamp copies live on the Copies list, marked with a chip, listing their numbers, with a filter
for and against them.

Everything a copy can do — offer, location, sale, trade, photos, multi-select, endless scroll — a
carrier must do too, and all of it is on that list already. A separate screen would be a second copy
of the machinery, a second place to search, and a second place to check when packing an offer.
Grouping does **not** file the piece under its leading stamp, which is the claim §3 removes.

### 8. `{catalog}` enumerates

For a multi-stamp copy the token renders every number in `sortOrder`, rather than picking one.

This is not a new rule: ADR-0020 §9 already has `{format}` list the distinct values when a batch
offer mixes them. A token resolving over several values enumerates. A leading number plus a new
`{catalogs}` was rejected because it reinstates the "first stamp matters more" asymmetry §3 removes,
and a buyer searching the third number would not find the offer.

### 9. The name

**Multi-stamp copy** — `multiStamp` in code, *kopia wieloznaczkowa* in Polish.

Every philatelic term on offer is narrower than the rule: an *entire* is not a fragment, a *mixed
franking* is not the same value three times, and *walor* (Polish for a collectable item) covers a
single stamp too. The descriptive name is the only one exactly coextensive with what the rule tests,
and it states why the piece is outside the counts.

## Schema

```prisma
model ItemStamp {
  id        String  @id @default(cuid())
  itemId    String
  stampId   String
  quantity  Int     @default(1)
  formatId  String?
  sortOrder Int
}
```

`Item` gains `stampCount Int @default(1)`.

```sql
-- the NULLS NOT DISTINCT idiom of ADR-0020's indexes: one carrier may hold the same stamp
-- as a single and as a block, and those are two entries
CREATE UNIQUE INDEX "item_stamp_unique"
  ON "item_stamp" ("itemId", "stampId", "formatId") NULLS NOT DISTINCT;
```

Backfill writes one entry per existing `Item` (its `stampId`, quantity 1, format null, sortOrder 0)
and leaves `stampCount` at 1, so no existing row changes meaning and nothing needs re-recording.
`onDelete: Cascade` from the item; `Restrict` from the stamp and from the format.

## Consequences

- `Item.stampId` and `Item.stampCount` are **derived**. One module (`src/lib/item-stamps.ts`) writes
  them; no call site sets them by hand, or the invariant §3 rests on decays silently.
- Editing a carrier back down to one stamp returns it to every count it had left. That is an
  ordinary edit with no confirmation of its own: the counts follow the facts.
- The existing 171 readers of `Item.stampId` keep working unchanged. What changes is what the value
  *means*, which is why §3 is enforced in the shared predicates rather than at each reader.
- Copies recorded before this ADR are untouched and stay correct — the backfill makes every one of
  them a one-entry carrier, which is what they are.
- Intake (#750) is deliberately last. The identify chain is the highest-traffic write path in the
  app, and it should extend an editor that has been proven rather than be the first thing to
  produce the new shape.

## Still open

- **Per-component condition.** A component is valued at the copy's condition, which is right for
  franking and would not be for a cover bearing one mint and one used stamp. Adding
  `ItemStamp.conditionId` later is additive and changes no rule above.
- **Completeness** (#133) is still unimplemented; when it is built it must apply §3 like every other
  count, and it may want to state carrier material separately rather than silently omitting it.
