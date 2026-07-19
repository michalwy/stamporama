-- Storage locations (#56, design decided in #55). Collection-scoped adjacency-list
-- hierarchy, same pattern as `collection_area`. `assignable` marks leaf storage that
-- can receive copies (grouping-only nodes are false; default true). `item` gains an
-- optional `locationId` (ON DELETE RESTRICT so a stored copy is never orphaned) and a
-- free-text `locationRef` (per-item, not unique).

CREATE TABLE "location" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "assignable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "location_collectionId_idx" ON "location"("collectionId");

ALTER TABLE "location" ADD CONSTRAINT "location_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "location" ADD CONSTRAINT "location_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "item" ADD COLUMN "locationId" TEXT;
ALTER TABLE "item" ADD COLUMN "locationRef" TEXT;

CREATE INDEX "item_locationId_idx" ON "item"("locationId");

ALTER TABLE "item" ADD CONSTRAINT "item_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
