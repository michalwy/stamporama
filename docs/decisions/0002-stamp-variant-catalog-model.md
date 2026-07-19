# ADR-0002: Stamp and Variant Data Model

## Status

Accepted

## Context

Before implementing any stamp CRUD, the data model for stamps, their variants, and the catalog hierarchy needed to be agreed upon. The model must support:

- Variants within a series (stamp 2 → variants 2a, 2b, 2c)
- Multi-level catalog standards (Michel basic: 2a; Michel specialized: 2ax, 2ay, 2az)
- Recording stamps where the exact variant is unknown
- Auction lot structures that reference stamps at any level of the hierarchy
- Multiple catalog numbers per stamp (primary + optional additional catalogs)
- Series/issue groupings that differ per catalog standard

See GitHub Issue #6 for the full design discussion. Catalog structure (`CatalogVendor` → `CatalogName` → `CatalogEdition`) was decided in Issue #8.

## Catalog model reference (from ADR / Issue #8)

Stamp numbering and series grouping attach to **`CatalogName`** — the named catalog standard (e.g., "Michel Grundkatalog", "Michel Spezialkatalog"). Numbering does not change between yearly editions, so linking to `CatalogEdition` (a specific year) would require re-linking everything when a new edition is published.

Only **prices** link to `CatalogEdition`, because prices change year to year.

```
CatalogVendor  (e.g. "Michel", abbreviation "Mi")
  └── CatalogName  (e.g. "Michel Grundkatalog", currency "EUR")
        └── CatalogEdition  (year 2024)  ← prices only
```

## Decisions

### 1. Variants are separate rows with their own IDs

Each variant (2a, 2b, 2c) is a distinct row in the database. This allows variants to carry their own catalog prices, notes, and references independently.

### 2. Parent-child tree via self-referencing FK on a single `Stamp` table

A single `Stamp` table is used for both base stamps and variants. A nullable `parentId` FK back to the same table forms the hierarchy:

```
Stamp "2"   (parentId = null)
  ├── Stamp "2a"  (parentId = id of "2")
  │     ├── Stamp "2ax" (parentId = id of "2a")
  │     ├── Stamp "2ay" (parentId = id of "2a")
  │     └── Stamp "2az" (parentId = id of "2a")
  ├── Stamp "2b"  (parentId = id of "2")
  └── Stamp "2c"  (parentId = id of "2")
```

The `Stamp` row itself does not carry a catalog reference. Catalog numbers are stored in a separate `StampCatalogNumber` junction table (see decision 5).

### 3. Unknown variant: link the specimen to the parent stamp row

A collector who has stamp 2 but cannot identify the variant links their `Item` (physical copy record) directly to the "stamp 2" parent row. A collector who has identified the variant links to the specific variant row (e.g., "2a"). No special flag or sentinel record is needed — the tree level of the linked entry implicitly encodes variant certainty.

"Stamp 2 (unknown variant)" and "stamp 2a (identified)" can coexist as separate `Item` rows in the same collection.

### 4. Basic/specialized catalog split is modeled by deeper tree levels

Michel Grundkatalog and Michel Spezialkatalog are separate `CatalogName` rows (under the same `CatalogVendor`). The specialized sub-variants (2ax, 2ay, 2az) are children of the basic variant (2a) in the `Stamp` tree. Each carries its own `StampCatalogNumber` entries pointing to the relevant `CatalogName`. A collection that uses both simultaneously has number entries for both catalog names at the appropriate tree levels.

### 5. Each stamp has a primary number plus optional additional catalog numbers; the primary catalog is inherited from the collection area

Each `Stamp` row may have one `StampCatalogNumber` per active `CatalogName`. One of those is the **primary number** — determined by which `CatalogName` the stamp's `CollectionArea` designates as primary. Additional catalog numbers (e.g., Scott, Zumstein) are optional.

**Configuration inheritance (top-down):**

```
CollectionArea
  ├── primaryCatalogNameId  → which CatalogName is primary
  └── activeCatalogs[]      → which CatalogNames are in use (CollectionAreaCatalog)

Stamp (top-level, linked to area)
  └── inherits the area's active catalog names and primary

Stamp (variant, linked to parent stamp)
  └── inherits from its parent stamp (which inherited from the area)
```

Stamps do not define which catalog is primary — that is always driven by the `CollectionArea`. No stamp-level override is allowed. The stamp only provides its number(s) for each active `CatalogName`.

### 6. Series/issues are groupings per `CatalogName`, above the stamp level

A `Series` is a named grouping of base stamps within a specific `CatalogName`. The same physical stamps may belong to different series in different catalogs (e.g., Michel groups stamps 1–10 as one series; Scott splits them into 1–5 and 6–10).

**Auto-creation for single-stamp series:** When a user adds a standalone stamp without specifying a series, the system automatically creates a `Series` record with `isAutoCreated = true`. The UI hides auto-created series that have exactly one member. If the stamp is later grouped into a real series, the auto-created series is deleted or reassigned.

**Completeness:** The catalog can require either (a) any variant of a base stamp, or (b) a specific variant. This is stored per series member as a nullable `requiredVariantId`. If null, any variant of the linked stamp counts toward completeness. If non-null, only that specific variant (or a more specific sub-variant) counts.

> **Revised by [ADR-0010](0010-stamp-subtype-variant-classification.md).** Where "any variant of a base stamp" counts toward completeness, "variant" means a child whose effective `actsAsVariant` is true (its per-stamp override, else its subtype's flag). Distinct-entry children (errors, overprints…) never satisfy the base stamp's slot on their own. (Ownership-based completeness is not yet implemented in code.)

```
Series (per CatalogName)
  └── SeriesMember
        ├── stampId           → base Stamp (parentId = null)
        └── requiredVariantId → specific Stamp variant (nullable; null = any variant OK)
```

## Proposed Prisma Schema

### CollectionArea additions

```prisma
model CollectionArea {
  // ... existing fields ...
  primaryCatalogNameId String?

  primaryCatalogName CatalogName?          @relation("AreaPrimaryCatalog", fields: [primaryCatalogNameId], references: [id])
  activeCatalogs     CollectionAreaCatalog[]
}

// Junction: which CatalogNames are active for an area
model CollectionAreaCatalog {
  collectionAreaId String
  catalogNameId    String

  collectionArea CollectionArea @relation(fields: [collectionAreaId], references: [id], onDelete: Cascade)
  catalogName    CatalogName    @relation(fields: [catalogNameId], references: [id])

  @@id([collectionAreaId, catalogNameId])
  @@map("collection_area_catalog")
}
```

### New Stamp model

```prisma
model Stamp {
  id           String   @id @default(cuid())
  collectionId String
  parentId     String?
  name         String?
  issuedYear   Int?

  collection      Collection            @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  parent          Stamp?                @relation("StampVariants", fields: [parentId], references: [id])
  children        Stamp[]               @relation("StampVariants")
  catalogNumbers  StampCatalogNumber[]
  collectionAreas StampCollectionArea[]
  items           Item[]

  @@map("stamp")
}

// One row per (stamp, catalog name) pair; stores the catalog number string
// Links to CatalogName, not CatalogEdition — numbering is stable across yearly editions
model StampCatalogNumber {
  stampId       String
  catalogNameId String
  number        String  // e.g. "2a"

  stamp       Stamp       @relation(fields: [stampId], references: [id], onDelete: Cascade)
  catalogName CatalogName @relation(fields: [catalogNameId], references: [id])

  @@id([stampId, catalogNameId])
  @@map("stamp_catalog_number")
}
```

### Series model

```prisma
// Links to CatalogName — series grouping is stable across yearly editions
model Series {
  id            String   @id @default(cuid())
  collectionId  String
  catalogNameId String
  name          String?
  isAutoCreated Boolean  @default(false)

  collection  Collection     @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  catalogName CatalogName    @relation(fields: [catalogNameId], references: [id])
  members     SeriesMember[]

  @@map("series")
}

model SeriesMember {
  seriesId          String
  stampId           String   // always the base stamp (parentId = null)
  requiredVariantId String?  // null = any variant counts; non-null = this specific variant required

  series          Series  @relation(fields: [seriesId], references: [id], onDelete: Cascade)
  stamp           Stamp   @relation("SeriesMemberStamp", fields: [stampId], references: [id], onDelete: Cascade)
  requiredVariant Stamp?  @relation("SeriesMemberVariant", fields: [requiredVariantId], references: [id])

  @@id([seriesId, stampId])
  @@map("series_member")
}
```

`StampCollectionArea.stampId` also needs a proper FK relation to `Stamp` (currently a bare `String`).

`Item` will be defined in issue #7 and will carry a `stampId` FK that may point to any level of the tree. The **primary number** of a specimen's stamp is resolved at query time by joining through `StampCatalogNumber` filtered to the area's `primaryCatalogNameId`.

## Consequences

- The tree is unbounded in depth, but in practice will be at most 2–3 levels (base stamp → basic variant → specialized sub-variant).
- Deleting a parent stamp cascades to all its variant children and their catalog numbers; downstream systems (auction lots, specimens) must handle orphaned references.
- Catalog data is user-defined per collection (no shared global catalog). See Issue #8.
- Resolving the primary number for a stamp requires knowing its `CollectionArea`, which may require an extra join when displaying stamps outside of an area context.
- Numbering stability: linking to `CatalogName` means new catalog year editions never require re-linking stamps. Only price records need updating when a new edition is added.
- Every stamp always belongs to a `Series` within its `CatalogName` (auto-created if needed). Completeness queries join through `SeriesMember.requiredVariantId` to determine which specimens satisfy each slot.
- The auto-created series pattern means the UI must filter `isAutoCreated = true && memberCount = 1` to suppress the series grouping level in list views.
