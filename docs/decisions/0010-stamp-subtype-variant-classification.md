# ADR-0010: Stamp Subtype — Classifying Child Stamps (Variant vs. Distinct Entry)

## Status

Accepted

## Context

ADR-0002 modelled variants as a self-referencing tree on a single `Stamp` table
(`parentId`), and ADR-0007 §2 encoded variant certainty purely by **tree level**: an
`Item` linked to a base stamp (`parentId = null`) means "I own this stamp but don't
know which variant"; an `Item` linked to a child row means an identified variant.

That structural rule — *any* base stamp with children is an "unknown variant"
umbrella — is baked into the UI and valuation:

- `SelectableStampNode` marks `depth === 0 && hasChildren` as "— unknown variant"
  and makes it selectable as such (`src/app/c/[collectionSlug]/inventory/selectable-stamp-node.tsx`).
- ADR-0007 §7 values an unknown-variant copy as the **lowest** catalog price among
  the base stamp's children, flagged uncertain.

The assumption "has children ⇒ is an unknown-variant umbrella" is wrong. Children of
a base stamp come in two philatelic flavours:

- **Real variants** — `2 → 2a, 2b` (colour, perforation, paper, watermark…). Here
  the base `2` legitimately *is* an abstract umbrella: owning `2` without knowing the
  variant is meaningful, and lowest-child valuation is correct.
- **Distinct entries** — `2 → 2 B1, 2 B2` (errors, plate flaws, overprints). These are
  their own fully-identified collectibles, nested under `2` only for catalog
  adjacency. The base `2` is a concrete, priced stamp in its own right and must
  **not** be treated as an unknown variant.

The distinction is a property of the **child's relationship to its parent**, not of
the parent alone — a parent can have *both* kinds of children at once
(`2 → 2a, 2b` variants **and** `2 B1` error). So the classification must live on the
child, and "the parent is an unknown-variant umbrella" becomes: *the parent has at
least one variant-kind child*.

See #6 (original variant discussion) and ADR-0002 / ADR-0007 for prior model.

## Decisions

### 1. A per-collection `StampSubtype` dictionary

Add a per-collection configurable set, the same shape and lifecycle as
`StampCondition` (ADR-0007 §3, #93) and `CertificateStatus` (#94): seeded with
sensible defaults, then fully user-editable (add / rename / reorder / delete) via a
settings panel alongside Conditions and Certificate statuses.

Each row carries:

- `name` — display label (e.g. "Colour variety", "Error").
- `actsAsVariant` `Boolean` — **the behavioural switch**. `true` means a child of
  this subtype makes its parent an unknown-variant umbrella and participates in
  lowest-child valuation and any-variant completeness. `false` means the child is a
  distinct concrete entry that leaves the parent untouched.
- `isDefault` `Boolean` — **exactly one** default per collection. The default subtype
  is assigned to a newly created child stamp.
- `sortOrder` `Int`.

Putting `actsAsVariant` on the dictionary row (rather than hard-coding a single magic
"variant" entry) is deliberate: philately has *several* variant-like categories
(colour, perforation, paper…) and *several* distinct-entry categories (error, plate
flaw, overprint). The behaviour is a property of the category, so it is normalised
onto the category.

**Default set seeded into every collection** (all editable):

| name               | actsAsVariant | isDefault |
| ------------------ | ------------- | --------- |
| Variant            | true          | **true**  |
| Colour variety     | true          | false     |
| Perforation variety| true          | false     |
| Paper variety      | true          | false     |
| Watermark variety  | true          | false     |
| Print variety      | true          | false     |
| Error              | false         | false     |
| Plate flaw         | false         | false     |
| Overprint          | false         | false     |

The generic **"Variant"** is kept as the seeded default: it is the type assigned to
new children and the backfill target for existing children (see §4), preserving
today's behaviour 1:1. It is an ordinary editable row, not a system sentinel.

### 2. `Stamp.subtypeId` — nullable FK, meaningful only for children

`Stamp` gains a nullable `subtypeId` FK to `StampSubtype`. It classifies a child
relative to its parent, so it is meaningful only when `parentId != null`; a top-level
stamp keeps `subtypeId = null`. A new child is created with the collection's default
subtype. `null` means "unclassified / not a variant" — there is no hidden
`null ⇒ variant` rule.

### 3. Behaviour keys off `actsAsVariant`, not tree shape

- **Unknown-variant umbrella:** a stamp is an unknown-variant umbrella ⇔ it has at
  least one child whose subtype has `actsAsVariant = true`. This replaces the
  `depth === 0 && hasChildren` rule in `SelectableStampNode` and drives the
  "— unknown variant" label, its selectability in pickers, and the `hasVariants`
  flag in `searchStampsForPicker` (`src/lib/stamps.ts`).
- **Valuation (revises ADR-0007 §7):** the lowest-child catalog price is taken only
  over children whose subtype `actsAsVariant = true`. A stamp with children that are
  *all* non-variant (e.g. `2 → 2 B1, 2 B2`) is valued by **its own** catalog price
  and is **not** flagged uncertain. A mixed parent keeps unknown-variant valuation
  over its variant children only.
- **Completeness (revises ADR-0002 §6):** wherever a base stamp is considered
  satisfiable by "any variant", that means any child whose subtype
  `actsAsVariant = true`. Non-variant children never satisfy the parent's slot on
  their own.

### 4. Exactly-one-default invariant, enforced in DB + app

- A **partial unique index** on `(collectionId) WHERE is_default` guarantees at most
  one default per collection at the storage layer.
- App logic guarantees at least one: setting a new default clears the previous one in
  the same transaction; the last remaining subtype, or the current default, cannot be
  deleted or un-defaulted without promoting another. `subtypeId` uses
  `onDelete: Restrict` (a subtype in use by any stamp cannot be deleted) — mirror the
  behaviour already used for in-use conditions/certificate statuses.

### 5. Seed runs in the migration, for existing collections too

The default set must reach **existing** collections, not only ones created after this
ships. The hand-written migration therefore:

1. creates `stamp_subtype` and its partial unique index;
2. adds the nullable `stamp.subtype_id` column + FK;
3. inserts the default set for **every existing collection**;
4. backfills every existing child (`parent_id IS NOT NULL`) to that collection's
   default ("Variant") row — preserving current unknown-variant behaviour exactly.

The collection-creation path also seeds the set for future collections
(`seedDefaultSubtypes`, run inside the creation transaction like
`seedDefaultConditions`). The canonical list lives in TypeScript
(`DEFAULT_STAMP_SUBTYPES`) and is **replicated by hand** in the migration SQL; the two
must be kept in sync.

## Schema sketch

```prisma
model StampSubtype {
  id            String   @id @default(cuid())
  collectionId  String
  name          String
  actsAsVariant Boolean  @default(true)
  isDefault     Boolean  @default(false)
  sortOrder     Int

  collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  stamps     Stamp[]

  @@map("stamp_subtype")
  // Partial unique index (one default per collection) written by hand in migration SQL:
  //   CREATE UNIQUE INDEX stamp_subtype_one_default
  //     ON stamp_subtype (collection_id) WHERE is_default;
}

model Stamp {
  // ... existing fields ...
  subtypeId String?
  subtype   StampSubtype? @relation(fields: [subtypeId], references: [id], onDelete: Restrict)
}
```

## Consequences

- ADR-0002 §3/§4 (variant certainty is *only* tree level) and ADR-0007 §2/§7
  (any-children ⇒ unknown variant; lowest-child valuation) are **revised** by this
  ADR. Those documents should cross-reference ADR-0010.
- The structural shortcut `depth === 0 && hasChildren` disappears from the client;
  the umbrella decision now needs each child's `subtype.actsAsVariant`, so list/picker
  queries must select it.
- Valuation domain logic (`src/lib/valuation.ts`) filters children by `actsAsVariant`
  before taking the lowest price; keep this out of UI components per the architecture
  rules.
- Users gain a third settings dictionary; the settings area grows a Subtypes panel.
- Migration is a **data migration** (seeds + backfill across all collections), heavier
  than the schema-only migrations so far. Seeded rows may use `gen_random_uuid()::text`
  ids in raw SQL; mixed cuid/uuid string ids in one table are functionally fine.
- `docs/user-guide/` (stamps / inventory) must explain subtypes and the
  variant-vs-distinct-entry distinction when the feature lands.
```
