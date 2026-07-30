-- Disposal axis on a copy (#394): the copy left the collector's hands *after* it arrived —
-- lost, damaged in storage, discarded. The involuntary counterpart to a sale: both are ways a
-- copy stops being physically held, one with proceeds and one without.
--
-- It is a fourth axis rather than a value on an existing one. `deliveryState` describes physical
-- intake and ends at arrival — its `not_delivered` / `damaged` outcomes mean "found broken while
-- sorting", and `not_delivered` additionally drops the copy from its lot and redistributes the
-- allocation (#122), which would be wrong here: the copy *did* arrive and *was* paid for. The
-- disposition flags (`inCollection` / `forSale` / `forTrade`) express intent, not possession.
--
-- `disposedAt` doubles as flag and timestamp (NULL = still held), so every read narrowing to the
-- copies actually held stays a plain `where` clause. `disposalReason` is one of
-- lost | damaged | other (the vocabulary lives in `src/lib/disposal.ts`, deliberately minimal —
-- the set can be widened later, never narrowed); `disposalNote` is required when the reason is
-- `other` and optional otherwise.
--
-- Nothing about the acquisition is touched: `costBasis`, `lotId`, `itemNo`, photos and the
-- variant history all stay, because the cost really was incurred — that retained cost basis is
-- what the holdings bar reports as a write-off (#396).
ALTER TABLE "item"
    ADD COLUMN "disposedAt" TIMESTAMP(3),
    ADD COLUMN "disposalReason" TEXT,
    ADD COLUMN "disposalNote" TEXT;

-- Every collection-scoped read narrows to the copies still held, so the flag is indexed together
-- with the scope rather than on its own.
CREATE INDEX "item_collectionId_disposedAt_idx" ON "item"("collectionId", "disposedAt");
