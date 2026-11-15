-- A copy that has left keeps a thumbnail and a reduced photo (#2547). Some time after a copy is sold,
-- given away in a trade or marked no longer held, its full-resolution photos are replaced by a
-- smaller one (about 1000 px on the long side) and the full-resolution bytes go.
--
-- The period is a **collection setting** (#577's rule), in its own nullable column holding the same
-- vocabulary as the other two retentions — `off`/`never` for keep for ever, `0` for the next sweep,
-- otherwise days. Null defers to `STAMPORAMA_DEPARTED_COPY_PHOTO_TTL_DAYS` and then to the built-in
-- default of 90 days, settled with the collector on 2026-11-15.
ALTER TABLE "collection" ADD COLUMN "departedCopyPhotoTtlDays" TEXT;

-- When a photo was reduced, or null for one still at full resolution. What the copy's screen says,
-- and what keeps the sweep from reducing a photo twice.
ALTER TABLE "photo" ADD COLUMN "reduced_at" TIMESTAMP(3);

-- When a trade was closed. The period a copy given away in a trade waits counts from it, and until
-- now nothing recorded the moment: `status` names the stage, never when it was reached. Written in
-- the same write that moves the trade to `closed`, which is terminal, so it is never cleared.
ALTER TABLE "trade" ADD COLUMN "closedAt" TIMESTAMP(3);

-- A trade closed before this column existed: closing made its purchase of what came in (#644), so
-- that purchase's creation is the moment. A trade with nothing incoming has no purchase and falls back
-- to the later of its two parcel dates, then to when it was agreed, then to when it was made.
UPDATE "trade" AS t
SET "closedAt" = COALESCE(
    (SELECT p."createdAt" FROM "purchase" AS p WHERE p."tradeId" = t."id"),
    GREATEST(t."sentAt", t."receivedAt"),
    t."agreedAt",
    t."createdAt"
)
WHERE t."status" = 'closed';
