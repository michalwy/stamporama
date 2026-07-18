# ADR-0008: Contact Entity + Boolean Role Model

## Status

Accepted

## Context

Physical copies (`Item`, ADR-0007) carry a free-form `acquisitionSource` string —
where or from whom a copy was obtained. As the collection grows the same
sellers, buyers, exchange partners, auction houses, and platforms recur, and the
free-form string offers no way to reuse, correct, or enrich them. The future
sales/trade layer (brief §5, ADR-0007 §4) needs to point lots at a counterparty as
a first-class entity, not a repeated string.

We therefore introduce a per-collection **Contact** — a lightweight address book of
everyone the collector deals with. This ADR fixes its shape. It is the foundation
the acquisition-source autocomplete (#103b) and the future sales/trade layer both
build on. Split from #103; issue #107.

## Decisions

### 1. Contact is a collection-scoped entity

`Contact` is scoped by `collectionId` like every other data model (owner has full
access, checks live server-side). Fields:

- `id`, `collectionId`
- `name` — **unique per collection** (`UNIQUE (collectionId, name)`).
- `notes` `String?`, `email` `String?`, `phone` `String?`
- the role flags below
- `createdAt`

No person/company type marker in v1. If a real need to distinguish individuals from
organizations appears, it can be added later.

### 2. Roles are independent, combinable boolean flags

A single contact can hold **several roles at once** — e.g. simultaneously a buyer, a
seller, and an exchange partner. Roles are therefore modeled as independent
`Boolean` columns (default `false`), **not** a single-value enum:

- `buyer`, `seller`, `exchangePartner`, `auctionHouse`, `platform`, `other`

This matches the disposition-flag pattern already used on `Item` (ADR-0007 §4,
`inCollection` / `forSale` / `forTrade`) and keeps the model consistent. An enum
array was rejected because it neither maps cleanly to Prisma/Postgres filtering nor
matches the established `Item` precedent.

### 3. Create-without-role is valid

`createContact` may be called with **no roles set**. The acquisition-source
autocomplete (#103b) creates a contact the moment the collector types a new name
(create-on-type); the roles are filled in separately, later. A role-less contact is
a legitimate, complete row — it is simply a name the collector has dealt with whose
relationship has not yet been characterized.

### 4. References to a contact use `onDelete: Restrict`

Foreign keys **pointing at** a contact (from `Item`'s future
`acquisitionContactId`, and from future sales lots) will use `onDelete: Restrict`: a
contact that is referenced cannot be deleted; it must be detached first. This
protects acquisition history and future lots from silently losing their
counterparty. (The FK **from** `Contact` to `Collection` is `onDelete: Cascade` as
usual — deleting a collection removes its contacts.)

No such references exist yet — this ADR records the rule so the child issues that
add them (#103b and the sales layer) apply it consistently.

## Schema

```
Contact
  id
  collectionId     → Collection  (onDelete: Cascade)
  name             String        (unique per collection)
  notes            String?
  email            String?
  phone            String?
  buyer            Boolean  @default(false)
  seller           Boolean  @default(false)
  exchangePartner  Boolean  @default(false)
  auctionHouse     Boolean  @default(false)
  platform         Boolean  @default(false)
  other            Boolean  @default(false)
  createdAt
```

Domain module `src/lib/contacts.ts` (server-only) exposes `listContacts`,
`searchContacts`, and `createContact`, all collection-owner-authorized. A search API
route and a create server action back the autocomplete.

## Consequences

- The per-collection unique name is enforced by a hand-written unique index; the
  domain surfaces a `ContactNameTakenError` so create-on-type can fall back to the
  existing row instead of failing.
- `Item.acquisitionSource` (free-form string) stays as-is for now; wiring copies to
  contacts via an `acquisitionContactId` FK (with the `onDelete: Restrict` rule
  above) is deferred to #103b.
- The sales/lot layer (brief §5) is out of scope here; this entity is the hook it
  will build on.
