# ADR-0020: Physical Format as an Axis of Its Own

## Status

Accepted. Supersedes the recording convention decided in #135, for homogeneous multiples only.

## Context

A multiple — a pair, a strip, a block of four — used to be recorded under the convention decided
in #135: its own `Stamp` row carrying a self-descriptive catalog number (`245 x4`, `245 pair`).
No schema change, no migration, and a multiple's price stayed out of the single's per-stamp
statistics for free, because statistics are keyed on `stampId`.

That holds while catalog numbers are flat. It collapses on a deep variant tree.

Michel's Deutsches Reich Infla issues reach four levels — `309 → 309A → 309AP → 309APa` —
and there the convention has two failures:

1. **Combinatorial growth.** Format and variant are independent dimensions, and folding one into
   the other means a pair must exist as a separate stamp under *every* node it might be identified
   at. Add strips and blocks and the count is `formats × nodes`.
2. **The format loses the tree.** A pair of `309BP` is not a child of a pair of `309B`, so
   "a pair whose variant I have not identified yet" — the everyday state of newly acquired
   material — cannot be expressed at all, short of duplicating the entire variant hierarchy
   beneath each format.

Neither is a matter of inconvenience: the second one makes correct data unrecordable.

## Decisions

### 1. Format is a per-collection dictionary, and a peer of condition

`StampFormat` has the shape and lifecycle of `StampCondition` (ADR-0006 §1): seeded at collection
creation, then fully editable. It is referenced from both ends of the same relationship condition
already spans — `Item.formatId` (what the copy physically is) and `StampCatalogPrice.formatId`
(what that format is worth).

### 2. A multiple is never decomposed

There is deliberately no unit count, and nothing anywhere multiplies or divides by one. A block of
four is one copy in one format, not four single copies, and not "worth four singles". Completeness
therefore treats format the way it treats condition — a breakdown dimension, so the question is
"do I have the whole series in pairs?", asked exactly as "do I have it in MNH?" is asked.

This follows the same reasoning #135 used to reject dividing a multiple's price by its unit count:
the premium on a multiple is not proportional and not predictable. What is true of the price is
equally true of the count.

### 3. Null means single

No "single" row exists in the dictionary and none is seeded. A null `formatId` **means** single,
exactly as a null `certificateStatusId` means "no certificate" (ADR-0006 §2). Every price and copy
recorded before formats existed stays correct with no backfill, and the existing
`NULLS NOT DISTINCT` index idiom extends to the new column rather than a second convention being
invented beside it.

### 4. Zusammendrucke keep their own `Stamp`

The #135 convention was not wrong about everything. Se-tenant combinations that carry their **own**
catalog number — Michel `S`/`W`/`K`/`Zd` — genuinely are distinct catalog entries with their own
price and their own completeness meaning, and they stay separate stamps. The boundary is whether
the catalog gives the thing a number of its own, not whether it holds more than one stamp.

### 5. A format's price is explicit or derived

An explicit `StampCatalogPrice` row for a format always wins. In its absence the price is the
single's price times a **multiplier**, flagged as derived.

Catalogs are published this way: Michel Spezial prints a Viererblock factor per issue and an
explicit price only where a multiple deviates. Following the source keeps data entry proportional
to what is actually printed, instead of demanding a condition × certificate × format grid on every
stamp — which is what makes the axis affordable at all.

### 6. One factor table with nullable anchors

`StampFormatFactor` carries a format, a number, and three optional anchors: area (matching any
descendant), issue, and condition. The row with every anchor null **is** the collection default;
there is no separate `defaultFactor` column, because a second mechanism would need a second
explanation in the UI.

The catalog was considered as a fourth anchor and left out: a collector recording prices from more
than one catalog is the exception, and the dimension would be dead weight for everyone else. It can
be added later without touching the resolution rule.

### 7. A multiplier is edited where its scope lives

An anchor is not a form field wherever the surrounding screen already answers it. An **issue's**
multipliers are edited from that issue's row on the Issues list, and an **area's** from its row
under Areas — in both cases the anchor is fixed by the screen and the form asks only for the
format, the number, and an optional condition.

Settings is the editor for the two scopes with no screen of their own: the collection default and
an area. It does **not** list issue-anchored rows at all, and excludes them **at the query** rather
than filtering them out afterwards — a collection can hold one per issue per format, which runs to
thousands of rows and is not a list anybody reads.

The alternative — one flat editor with an area picker feeding an issue picker — was built first and
removed for two reasons: picking an issue out of a cascading list, away from the issue itself, is
how a rule ends up filed against the wrong one; and the resulting list does not stay readable at
the scale issue anchors reach.

A scoped list shows what is set on **that** row alone, never what would apply to it through
inheritance — it is an editor, and listing a parent's rule inside a child invites editing the
parent from the wrong place.

### 8. Fixed precedence, not a specificity score

Candidates are compared on `(issue set?, area depth, condition set?)`, lexicographically, first
difference wins. Scoring independent dimensions against one another produces orderings no user can
predict from the interface; a fixed order is always explainable in one line ("from: Infla 1923 →
block of 4").

The consequence is deliberate: **where** outranks **for which condition**, so a factor anchored to
an issue beats a collection-wide factor anchored to "used".

## Schema

```prisma
model StampFormat {
  id           String @id @default(cuid())
  collectionId String
  name         String
  abbreviation String
  sortOrder    Int
}

model StampFormatFactor {
  id               String  @id @default(cuid())
  collectionId     String
  formatId         String
  factor           Decimal @db.Decimal(10, 4)
  collectionAreaId String?
  issueId          String?
  conditionId      String?
}
```

```sql
-- migration-only; not expressible in schema.prisma
CREATE UNIQUE INDEX "stamp_format_factor_unique"
  ON "stamp_format_factor" ("collectionId", "formatId", "collectionAreaId", "issueId", "conditionId")
  NULLS NOT DISTINCT;

-- rebuilt: format joins the price's logical identity
CREATE UNIQUE INDEX "stamp_catalog_price_unique"
  ON "stamp_catalog_price" ("stampId", "catalogEditionId", "conditionId", "certificateStatusId", "formatId")
  NULLS NOT DISTINCT;
```

## Consequences

- The resolution rule is pure (`src/lib/format-factor.ts`) and unit-tested; the server module
  around it (`format-pricing.ts`) resolves per stamp, because it needs the stamp's area ancestry
  and issue — facts the price grid has no reason to hold.
- The price grid gains **format tabs** rather than more columns. A derived value renders as the
  cell's placeholder and stores nothing; typing over it creates an explicit row, clearing it
  returns to derived.
- The scoped editor is one component (`shared/use-format-factors-action.tsx`), exposed both as a
  `{ action, dialog }` row-action hook and as a plain dialog, because the areas panel renders its
  rows in a `.map` and cannot call a hook per row.
- A price cell's form key grows a trailing format segment
  (`<editionId>~<conditionId>~<certId>~<formatId>`). It is trailing and optional, so a payload
  written before formats existed still parses.
- Deleting a format is refused while a price or a copy references it (`Restrict`); its factor rows
  cascade, since a factor is a rule *about* the format and means nothing without it.
- Multiples already recorded under the #135 convention keep working — they are ordinary stamps and
  nothing migrates them. Re-recording one as a copy with a format is a manual choice, per stamp.

## Still open

- Completeness (#133) is unimplemented; when it is built, format is its third breakdown dimension
  alongside disposition and condition.
- List views have a condition switcher (ADR-0006 §5) but no format switcher yet.
- Formats carry no translations (#294-style) because nothing renders one into a listing title yet.
- #136 documents the superseded convention and needs rewriting to state the boundary in §4.
