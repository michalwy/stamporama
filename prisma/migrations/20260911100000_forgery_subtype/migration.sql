-- Seed the `Forgery` subtype into every existing collection (ADR-0049 §1, #1000).
--
-- A forgery is a `Stamp`: a child of the stamp it imitates, classified by an ordinary
-- subtype row rather than by a second mechanism — identifying a forgery is the same work
-- as identifying a variant. `actsAsVariant = false` puts it in ADR-0010 §1's *distinct
-- entry* column beside Error, Plate flaw and Overprint: owning a forgery completes no
-- series and it is not the lowest child price of the genuine stamp. That flag is also
-- what keeps a forgery's photo off the genuine stamp, since `src/lib/photos.ts` breaks
-- the promotion walk on `!childIsVariant(current)` (#347, #368).
--
-- There is NO schema change here. This is a pure data migration: one dictionary row per
-- existing collection. New collections get the row from `DEFAULT_STAMP_SUBTYPES`
-- (`src/lib/subtypes.ts`) through `seedDefaultSubtypes`, which derives `sortOrder` from
-- the array index; the two paths must land on the same number for an untouched collection,
-- and the expression below is what makes them agree.
--
-- The row is an ordinary editable dictionary row and deliberately NOT a system sentinel:
-- the collector may rename it, reorder it or delete it, and nothing in the application
-- keys on the name `Forgery`.
--
-- Two decisions in the statement, both about what this project's schema does not enforce:
--
--   * `sortOrder` is a plain `Int` with no unique constraint, so a hardcoded 9 would not
--     fail in a collection whose collector has added rows of their own — it would just
--     sort oddly, silently, among them. `COALESCE(MAX("sortOrder"), -1) + 1` is what
--     `createStampSubtype` already does when the collector appends a row by hand, so this
--     migration appends the way the application appends. In an untouched collection the
--     nine seeded rows hold 0..8 and this lands on 9, which is the array index the
--     TypeScript path derives for the same row.
--
--   * There is no unique index on ("collectionId", "name") — the only unique index on this
--     table is the hand-written partial one on "isDefault", and this row is not the
--     default, so nothing in the database would stop a second row named `Forgery` in a
--     collection where the collector has already made one. The `NOT EXISTS` guard is that
--     check. It is case-insensitive because the collector types the name, and it leaves
--     their row exactly as it stands — including its own `actsAsVariant`, which is their
--     classification to make and not this migration's to overwrite.
--
-- No `stamp_subtype_translation` rows are written, matching the nine rows seeded by
-- `20260719100000_add_stamp_subtype` and `seedDefaultSubtypes`, neither of which writes
-- any either. A missing translation is absence rather than a defect: the translation
-- editor reads no row as an empty `current`, and a non-default subtype with no translation
-- surfaces as an ordinary fillable gap in the listing-title preview (#298/#299) — which is
-- already what Error, Plate flaw and Overprint do today.

INSERT INTO "stamp_subtype" ("id", "collectionId", "name", "actsAsVariant", "isDefault", "sortOrder")
SELECT
    gen_random_uuid()::text,
    c."id",
    'Forgery',
    false,
    false,
    COALESCE((SELECT MAX(s."sortOrder") FROM "stamp_subtype" s WHERE s."collectionId" = c."id"), -1) + 1
FROM "collection" c
WHERE NOT EXISTS (
    SELECT 1 FROM "stamp_subtype" s
    WHERE s."collectionId" = c."id" AND lower(s."name") = 'forgery'
);
