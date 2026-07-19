-- StampSubtype dictionary (ADR-0010, #127). A per-collection, user-editable set that
-- classifies a child stamp relative to its parent. `actsAsVariant` is the behavioural
-- switch: true => the child makes its parent an unknown-variant umbrella (lowest-child
-- valuation, any-variant completeness); false => the child is a distinct concrete entry
-- that leaves the parent untouched. Exactly one `isDefault` per collection, enforced by
-- a partial unique index.
--
-- This is a DATA migration: it also seeds the default set into every EXISTING collection
-- and backfills every existing child stamp (parentId IS NOT NULL) to that collection's
-- default ("Variant") row, preserving today's has-children => unknown-variant behaviour
-- 1:1. The canonical default set is replicated in TypeScript as DEFAULT_STAMP_SUBTYPES
-- (src/lib/subtypes.ts) for the collection-creation path; the two must stay in sync.

CREATE TABLE "stamp_subtype" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "actsAsVariant" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "stamp_subtype_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stamp_subtype_collectionId_idx" ON "stamp_subtype"("collectionId");

-- At most one default subtype per collection.
CREATE UNIQUE INDEX "stamp_subtype_one_default"
    ON "stamp_subtype"("collectionId") WHERE "isDefault";

ALTER TABLE "stamp_subtype" ADD CONSTRAINT "stamp_subtype_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable classification FK on the child stamp. Meaningful only when parentId != null;
-- ON DELETE RESTRICT so a subtype in use by any stamp cannot be deleted.
ALTER TABLE "stamp" ADD COLUMN "subtypeId" TEXT;

CREATE INDEX "stamp_subtypeId_idx" ON "stamp"("subtypeId");

ALTER TABLE "stamp" ADD CONSTRAINT "stamp_subtypeId_fkey"
    FOREIGN KEY ("subtypeId") REFERENCES "stamp_subtype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the canonical default set for every existing collection.
INSERT INTO "stamp_subtype" ("id", "collectionId", "name", "actsAsVariant", "isDefault", "sortOrder")
SELECT gen_random_uuid()::text, c."id", d."name", d."actsAsVariant", d."isDefault", d."sortOrder"
FROM "collection" c
CROSS JOIN (VALUES
    ('Variant',             true,  true,  0),
    ('Colour variety',      true,  false, 1),
    ('Perforation variety', true,  false, 2),
    ('Paper variety',       true,  false, 3),
    ('Watermark variety',   true,  false, 4),
    ('Print variety',       true,  false, 5),
    ('Error',               false, false, 6),
    ('Plate flaw',          false, false, 7),
    ('Overprint',           false, false, 8)
) AS d("name", "actsAsVariant", "isDefault", "sortOrder");

-- Backfill every existing child to its collection's default ("Variant") subtype.
UPDATE "stamp" s
SET "subtypeId" = def."id"
FROM "stamp_subtype" def
WHERE s."parentId" IS NOT NULL
  AND def."collectionId" = s."collectionId"
  AND def."isDefault" = true;
