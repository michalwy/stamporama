-- A dictionary of faults, and a copy's faults chosen from it (#1557).
--
-- A copy's condition (MNH, MH, U…) says nothing about its individual faults: a thinned gum, a
-- missing tooth, a crease, a hinge remnant. The collector defines the faults once, in Settings, and
-- picks a copy's from them — so a fault can be filtered on and, later, printed in an offer's
-- description in the platform's language (#1559).

CREATE TABLE "fault" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fault_collectionId_name_key" ON "fault"("collectionId", "name");
CREATE INDEX "fault_collectionId_idx" ON "fault"("collectionId");

ALTER TABLE "fault" ADD CONSTRAINT "fault_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fault_translation" (
    "faultId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "fault_translation_pkey" PRIMARY KEY ("faultId", "language")
);

ALTER TABLE "fault_translation" ADD CONSTRAINT "fault_translation_faultId_fkey"
    FOREIGN KEY ("faultId") REFERENCES "fault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "item_fault" (
    "itemId" TEXT NOT NULL,
    "faultId" TEXT NOT NULL,

    CONSTRAINT "item_fault_pkey" PRIMARY KEY ("itemId", "faultId")
);

CREATE INDEX "item_fault_faultId_idx" ON "item_fault"("faultId");

-- CASCADE at both ends. A fault in use must not be deleted, and that rule is `deleteFault`'s
-- (`src/lib/faults.ts`), which refuses with the count: as ON DELETE RESTRICT on "faultId" it would
-- also fire while a whole collection is deleted, because the cascade into "fault" runs before the
-- one into "item_fault" that deleting the copies only queues later — the collision measured and
-- written up in `20260911120000_multi_stamp_copies` for "item_stamp".
ALTER TABLE "item_fault" ADD CONSTRAINT "item_fault_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_fault" ADD CONSTRAINT "item_fault_faultId_fkey"
    FOREIGN KEY ("faultId") REFERENCES "fault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The common faults, in every existing collection — what `seedDefaultFaults` writes into a new one.
-- The two lists are kept in step by hand and `tests/integration/faults-domain.test.ts` checks that
-- they agree. English names only and no translation rows, as every other seeded dictionary here
-- (settled with the collector on 2026-10-03); the collector renames, reorders or removes them.
INSERT INTO "fault" ("id", "collectionId", "name", "sortOrder")
SELECT gen_random_uuid()::text, c."id", d."name", d."sortOrder"
FROM "collection" c
CROSS JOIN (VALUES
    ('Thin', 0),
    ('Thinned gum', 1),
    ('Missing tooth', 2),
    ('Short perforation', 3),
    ('Crease', 4),
    ('Tear', 5),
    ('Hinge remnant', 6),
    ('Stain', 7)
) AS d("name", "sortOrder");
