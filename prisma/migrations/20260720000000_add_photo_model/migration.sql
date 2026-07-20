-- Photos attached to inventory copies (#112, ADR-0011). One `item` has many `photo`s.
-- `role` reserves two singleton slots (front/back); the partial-null unique on
-- (itemId, role) forbids two fronts or two backs while leaving titled extras (role NULL,
-- distinct in Postgres) unlimited. `storageBackend` is the per-photo read seam for a
-- future GCS binding (write-one-read-many); bytes are managed via the storage interface.
CREATE TABLE "photo" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "role" TEXT,
    "title" TEXT,
    "storageBackend" TEXT NOT NULL DEFAULT 'filesystem',
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "photo_itemId_role_key" ON "photo"("itemId", "role");

CREATE INDEX "photo_itemId_idx" ON "photo"("itemId");

ALTER TABLE "photo" ADD CONSTRAINT "photo_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Staging rows for eager, pre-Save photo uploads (#112). Bytes are written to the active
-- storage backend under a staging key before any `photo` row exists; Save promotes selected
-- uploads into `photo` rows. An hourly orphan-GC sweep deletes rows older than the TTL and
-- their bytes — indexed on createdAt for the cutoff scan.
CREATE TABLE "photo_upload" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL DEFAULT 'filesystem',
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_upload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "photo_upload_createdAt_idx" ON "photo_upload"("createdAt");
