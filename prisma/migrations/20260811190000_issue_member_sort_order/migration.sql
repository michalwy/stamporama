-- Manual ordering of the stamps in an issue (#549).
--
-- The tree had no ORDER BY at all until now, so this is the first time the order is stated. Every
-- existing member is seeded in **insertion order** — `stamp.created_at`, the order the collector
-- added them — with the stamp id as a stable tiebreak for stamps created in the same transaction
-- (a bulk range add creates a whole issue's worth at once).
--
-- One dense sequence per issue is enough: a sibling group's members only ever compare with each
-- other, so values shared across groups are never read against one another.

ALTER TABLE "issue_member" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "issue_member" AS m
SET "sortOrder" = ranked.rn
FROM (
  SELECT
    im."issueId",
    im."stampId",
    (ROW_NUMBER() OVER (
      PARTITION BY im."issueId"
      ORDER BY s."createdAt" ASC, im."stampId" ASC
    ))::int - 1 AS rn
  FROM "issue_member" im
  JOIN "stamp" s ON s."id" = im."stampId"
) AS ranked
WHERE m."issueId" = ranked."issueId" AND m."stampId" = ranked."stampId";

CREATE INDEX "issue_member_issueId_sortOrder_idx" ON "issue_member"("issueId", "sortOrder");
