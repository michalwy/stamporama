-- The parts of a chunked card scan never reach the storage backend (#590).
--
-- The migration before this one gave `scan_upload` a `storageKey` and a `storageBackend`, because
-- the parts were written as ordinary storage objects under `staging/scan-uploads/<id>/`. That is
-- wrong on GCS in a way that is invisible on the filesystem: a 200 MB card would go up as parts and
-- come straight back down seconds later to be assembled, only to be deleted — 400 MB of transfer
-- and hundreds of operations for bytes that never needed to leave the machine.
--
-- A chunk is written once, read once and deleted, with an explicit lifecycle (finalize, abort, or
-- the sweep). That is staging, and staging belongs on local disk whatever the active backend is:
-- the parts now live under `STAMPORAMA_DATA_DIR/scan-uploads/<id>/`, and only the assembled sheet
-- is handed to the storage interface. **This is not a cache of a remote object** — that is a
-- separate mechanism with its own policy (#591) — because these bytes were never remote.
--
-- So both columns go, and `collectionId` with them: it existed only to build the storage prefix,
-- ownership being checked through the purchase. Nothing of the collector's is at risk — this table
-- only ever holds an upload that is in flight or one already abandoned, never a scan that has been
-- stored. An upload caught mid-flight by this migration cannot be finished (its parts are in the
-- old place and the assembly looks in the new one): finalize fails, the row and its files are
-- discarded as they are on any other failure, and the card is sent again. Parts left in the
-- backend's `staging/scan-uploads/` are then orphaned, since the sweep now looks only on local
-- disk — worth deleting by hand on an instance that ran the intermediate version, and nothing at
-- all on one that did not.
ALTER TABLE "scan_upload" DROP COLUMN "storageKey";
ALTER TABLE "scan_upload" DROP COLUMN "storageBackend";
ALTER TABLE "scan_upload" DROP COLUMN "collectionId";
