# ADR-0007: Per-Copy Physical Holdings (`Item`) Model

## Status

Accepted

## Context

The stamp/variant/catalog/pricing layers were designed in ADR-0002 (Issues #6, #8)
and ADR-0006. Those describe the *catalog* — the abstract stamps that exist. This
ADR describes the collector's *physical holdings*: the actual copies they own.

The core principle (from Issue #7): **each physical copy of a stamp is a separate
record**, because copies of the same stamp/variant/condition can differ in ways
that affect value and intent. A quantity field ("Used × 3") cannot represent this —
one Used copy may carry an interesting commemorative postmark (higher value),
another a normal postmark (standard), another an illegible one (lower). Each is a
distinct row.

ADR-0002 already anticipated this record and named it `Item` ("physical copy
record"). This ADR finalizes its shape. See Issue #7 for the full discussion.

## Decisions

### 1. One `Item` row per physical copy

No quantity field. Each owned copy is its own row, freely differentiated by notes,
condition, certificate, and disposition. This supersedes the earlier
`docs/product/brief.md` mention of a "quantity" field on collection items.

### 2. Variant reference — reuse ADR-0002's tree-level encoding

`Item.stampId` links to a `Stamp` row at any level of the variant tree:

- **Identified copy** → link to the specific variant row (e.g. `2b`).
- **Unknown variant** → link to the base stamp row (`parentId = null`, e.g. `2`).

No sentinel record or "unknown" flag: the tree level of the linked stamp implicitly
encodes variant certainty. "Stamp 2 (unknown)" and "stamp 2a (identified)" coexist
as separate `Item` rows in the same collection. (Confirms ADR-0002 decision 3.)

### 3. Condition & certificate are FKs to the per-collection configurable sets

- `conditionId` → `StampCondition` (per-collection scale, Issue #93). Not free-form.
- `certificateStatusId` → `CertificateStatus` (per-collection set, Issue #94), nullable.
  A physical copy may be certified independently of any catalog-price dimension.

### 4. Disposition — independent, combinable boolean flags on the `Item`

A copy can hold **any combination** of roles simultaneously (e.g. a collection
specimen you would also sell for the right price):

- `inCollection` — kept as (part of) the collection.
- `forSale`
- `forTrade`

Modeled as independent booleans, **not** a mutually-exclusive status enum. These
flags are inventory markers. The actual sale/trade happens later by assembling
copies into **lots** (a future Sales feature, brief §5); the flags exist chiefly to
filter/select copies when building a lot. Asking price, venue, listed/sold dates,
and profit/loss therefore belong to that future lot/listing layer, **not** to `Item`.

### 5. Acquisition & purchase fields live on the `Item` (manual now, automated later)

- `acquisitionSource` — free-form `String?` (where/from whom obtained).
- `acquiredDay` / `acquiredMonth` / `acquiredYear` — nullable `Int` partial date,
  mirroring the `Stamp` issued-date pattern.
- `purchasePrice` `Decimal?` + `purchaseCurrency` `String?` — mirrors
  `StampCatalogPrice` money shape; feeds future profit/loss tracking.

A future **purchasing/acquisitions module** will populate the acquisition source,
date, and purchase price automatically. For the first version they are entered by
hand. `notes` (`String?`) holds free-form per-copy detail (e.g. postmark type).

### 6. Variant refinement is re-point + history

When a collector later identifies an unknown-variant copy, its `stampId` is
**re-pointed in place** from the base stamp to the specific variant. Additionally, a
row is appended to an **`ItemVariantHistory`** table recording the change:

```
ItemVariantHistory
  itemId
  fromStampId
  toStampId
  changedAt
  note?         (optional reason)
```

This gives a traceable refinement trail without versioning the whole `Item`.

### 7. Valuation of an unknown-variant copy: lowest child price, flagged uncertain

An `Item` linked to a base stamp has no single catalog price. Its value is taken as
the **lowest** catalog price among the base stamp's child variants for the copy's
condition (and certificate dimension where applicable), and the value is **flagged
as uncertain** in the UI. An identified copy uses its variant's own single price.

Rationale: matches Issue #6's "probably cheapest, but not guaranteed"; keeps
holdings totals summable as concrete numbers while signalling uncertainty. In
sale/trade contexts the variant uncertainty must remain **visible to the
counterparty** — it is never silently resolved to a specific variant for pricing.

## Schema sketch (not yet migrated)

```
Item
  id
  collectionId          → Collection   (scoping)
  stampId               → Stamp        (base = unknown variant; variant = identified)
  conditionId           → StampCondition
  certificateStatusId?  → CertificateStatus
  inCollection  Boolean
  forSale       Boolean
  forTrade      Boolean
  acquisitionSource  String?
  acquiredDay/Month/Year  Int?
  purchasePrice  Decimal?
  purchaseCurrency String?
  notes          String?
  createdAt

ItemVariantHistory
  id
  itemId        → Item
  fromStampId   → Stamp
  toStampId     → Stamp
  changedAt
  note          String?
```

## Consequences

- No Prisma changes in this ADR (Issue #7 is design-only). Implementation is split
  into child issues (schema/migration, CRUD API, list UI, unknown-variant &
  refinement, valuation, sale/trade listing groundwork).
- `docs/product/brief.md`'s "quantity" wording for collection items is now
  superseded and must be corrected when the schema lands.
- Valuation logic (lowest-child-price for unknown variants) is shared domain logic;
  keep it out of UI components per the architecture rules.
- The Sales/lot layer (brief §5) is out of scope here; disposition flags are the
  only hook this model exposes toward it.
```
