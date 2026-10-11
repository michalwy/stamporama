-- When a trade was agreed (#1813) — what the dashboard's *To send* group measures a trade's wait
-- from. Until now nothing said: `status` names the stage and never the moment it was reached, and
-- `sentAt` / `receivedAt` only start once a parcel moves.
--
-- Lives exactly as long as the agreement's frozen valuations do: written when the trade becomes
-- `agreed`, cleared when it goes back to a status its list can be edited in, kept through `closed`
-- and `cancelled` as history. Nullable: a trade that was never agreed has no such moment.
ALTER TABLE "trade" ADD COLUMN "agreedAt" TIMESTAMP(3);

-- A trade agreed before this column existed already carries the moment, in the snapshots its lines
-- were frozen into at that very transition (#638). The earliest of them is the agreement. A trade
-- agreed with no lines has no snapshot and stays null — the dashboard then shows no age rather than
-- inventing one.
UPDATE "trade" AS t
SET "agreedAt" = frozen."firstFrozenAt"
FROM (
    SELECT l."tradeId", MIN(v."frozenAt") AS "firstFrozenAt"
    FROM "trade_line_valuation" AS v
    JOIN "trade_line" AS l ON l."id" = v."lineId"
    GROUP BY l."tradeId"
) AS frozen
WHERE frozen."tradeId" = t."id";
