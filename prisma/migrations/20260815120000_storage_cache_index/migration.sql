-- The index of the local cache in front of a remote storage backend (#591).
--
-- With a remote backend the app fetches back bytes it wrote moments earlier: a card scan is written
-- to the bucket and the very next thing that happens is detection reading it to propose the cut,
-- and an offer's collages re-read the same copy scans on every regeneration. The objects are
-- immutable under their key, so there is no staleness and nothing to invalidate; what has to be
-- protected is disk, which a TTL cannot bound (twenty cards at 200 MB inside one hour is 4 GB
-- whatever the TTL says) and a size cap bounds by construction.
--
-- This table is the `used` that least-recently-used needs, and it is a table rather than filesystem
-- metadata because there is none to use: `atime` is off on most modern mounts and `mtime` records
-- writing, not use. A row per access is affordable because only *work* populates the cache and
-- never delivery, so accesses are few and large. It also means the cache survives a restart.
--
-- Row and file may drift by design: a row whose file is gone is a miss, and a file with no row is
-- garbage the eviction pass collects.
CREATE TABLE "storage_cache_entry" (
    "backend" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_cache_entry_pkey" PRIMARY KEY ("backend","key")
);

-- The LRU's ordering: an eviction pass reads oldest-used first.
CREATE INDEX "storage_cache_entry_lastUsedAt_idx" ON "storage_cache_entry"("lastUsedAt");

-- Storage keys are collection-scoped (ADR-0011), so *clear this collection's entries* is a prefix
-- match on the key and the cache needs no partitioning to be clearable per collection.
CREATE INDEX "storage_cache_entry_key_idx" ON "storage_cache_entry"("key");
