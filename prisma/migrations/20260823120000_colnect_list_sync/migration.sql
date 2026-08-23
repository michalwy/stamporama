-- Colnect list sync (#684) — the four tables the export → compare → fix loop stands on.
--
-- Colnect offers no API and no import, only a CSV export of a list. So keeping the collector's
-- Swap list in step with `Item.forTrade` (and Collection / Wish / Sell with their own predicates)
-- means loading an export, comparing it, and fixing whichever side is wrong. Nothing here reads or
-- writes Colnect; this is the configuration and the storage the rest of #685–#690 needs.
--
-- The join key throughout is `Stamp.colnectId` (#247). It is not referenced by a foreign key: a
-- snapshot row is what a *file* said, and a file routinely names items this collection has never
-- heard of — that is precisely the difference the report is for.

-- One Colnect list this collection keeps in sync. `lt` is Colnect's own list id (2 = Collection,
-- 3 = Swap, 4 = Wish, 5 = Sell), a plain integer so a custom list needs no migration. `source` is
-- our predicate, `sourceOfTruth` says which side wins when the two disagree; both are validated in
-- `colnect-list-sync-rules.ts` rather than by a check constraint, so adding a predicate stays a
-- code change.
CREATE TABLE "colnect_list_mapping" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "lt" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceOfTruth" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colnect_list_mapping_pkey" PRIMARY KEY ("id")
);

-- Two rows for one list would be two opinions about what it mirrors, and the import has to find
-- exactly one.
CREATE UNIQUE INDEX "colnect_list_mapping_collectionId_lt_key" ON "colnect_list_mapping"("collectionId", "lt");
CREATE INDEX "colnect_list_mapping_collectionId_idx" ON "colnect_list_mapping"("collectionId");

ALTER TABLE "colnect_list_mapping" ADD CONSTRAINT "colnect_list_mapping_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What one export said. **One per mapping** — the unique on `mappingId` is the rule, not an
-- optimisation: the report is always about the list as it stands, and a re-import replaces the
-- snapshot rather than filing a second answer to "what is on Colnect" beside the first.
CREATE TABLE "colnect_list_snapshot" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3),
    "declaredCount" INTEGER,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colnect_list_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "colnect_list_snapshot_mappingId_key" ON "colnect_list_snapshot"("mappingId");

ALTER TABLE "colnect_list_snapshot" ADD CONSTRAINT "colnect_list_snapshot_mappingId_fkey"
    FOREIGN KEY ("mappingId") REFERENCES "colnect_list_mapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row of that file. `colnectId` comes out of the row's `Link` — the export has no id column.
-- `quantity` and `conditionAbbrev` are the values for **this** list, read positionally out of the
-- per-list columns; null is a blank cell, which the report reads as one and as no grade stated.
CREATE TABLE "colnect_list_snapshot_row" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "colnectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "catalogCodes" TEXT NOT NULL,
    "quantity" INTEGER,
    "conditionAbbrev" TEXT,

    CONSTRAINT "colnect_list_snapshot_row_pkey" PRIMARY KEY ("id")
);

-- The lookup the report does, and deliberately not unique: a real export names an item once per
-- list, but a hand-edited file may repeat it, and whether that is an error is the import's
-- judgement (#685) rather than a constraint failure 20,000 rows into a bulk insert.
CREATE INDEX "colnect_list_snapshot_row_snapshotId_colnectId_idx" ON "colnect_list_snapshot_row"("snapshotId", "colnectId");

ALTER TABLE "colnect_list_snapshot_row" ADD CONSTRAINT "colnect_list_snapshot_row_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "colnect_list_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A difference the collector accepts on purpose. It hangs off the **mapping**, so it survives a
-- re-import — unlike "done on Colnect" (#686), which hangs off the snapshot and dies with it.
-- `kind` is part of the key because the direction of a difference can flip, and an acceptance of
-- one direction must not silently swallow the other.
CREATE TABLE "colnect_list_decision" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "colnectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colnect_list_decision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "colnect_list_decision_mappingId_colnectId_kind_key" ON "colnect_list_decision"("mappingId", "colnectId", "kind");
CREATE INDEX "colnect_list_decision_mappingId_idx" ON "colnect_list_decision"("mappingId");

ALTER TABLE "colnect_list_decision" ADD CONSTRAINT "colnect_list_decision_mappingId_fkey"
    FOREIGN KEY ("mappingId") REFERENCES "colnect_list_mapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
