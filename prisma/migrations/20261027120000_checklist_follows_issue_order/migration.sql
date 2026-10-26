-- An issue's checklist follows the issue's stamp order until it is given an order of its own (#2208).
--
-- The issue's stamps (`issue_member."sortOrder"`, #549) and each checklist's (`checklist_stamp."sortOrder"`,
-- #764) were two orders that never met: reordering an issue left every checklist of it reading as
-- before. A checklist now either **follows its issue** — its stamps read as the issue's tree reads
-- top to bottom, a stamp then its variants under it, keeping only the stamps on the checklist — or
-- has an **order of its own** (`ownOrder`). The following ones keep their `sortOrder` written in the
-- issue's order, so every reader of a checklist's order reads it unchanged.
--
-- Which way each existing checklist goes:
--
-- - one spanning issues has no issue to follow and keeps its own order;
-- - an issue's checklist whose order is still the catalogue's — the order #764 backfilled,
--   `stamp."primaryCatalogSortKey"`, the name, then the id — was never given one of its own, and
--   follows its issue from now on;
-- - any other has been dragged into an order, and keeps it as its own.

ALTER TABLE "checklist" ADD COLUMN "ownOrder" BOOLEAN NOT NULL DEFAULT false;

UPDATE "checklist" SET "ownOrder" = true WHERE "issueId" IS NULL;

UPDATE "checklist" AS k
SET "ownOrder" = true
WHERE k."issueId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM (
      SELECT
        ROW_NUMBER() OVER (ORDER BY c."sortOrder", c."stampId") AS "stored",
        ROW_NUMBER() OVER (
          ORDER BY s."primaryCatalogSortKey" ASC NULLS LAST, s."name" ASC NULLS LAST, c."stampId" ASC
        ) AS "catalogue"
      FROM "checklist_stamp" c
      JOIN "stamp" s ON s."id" = c."stampId"
      WHERE c."checklistId" = k."id"
    ) AS ranked
    WHERE ranked."stored" <> ranked."catalogue"
  );

-- The issue's tree read down the page, as `flattenMemberTree` reads it: roots are the members whose
-- parent is not a member of the same issue, siblings go by `sortOrder` then id. Each member carries
-- the path of positions from its root, which sorts (byte-wise) in exactly that reading order.
CREATE TEMPORARY TABLE "_issue_reading" AS
WITH RECURSIVE "walk" AS (
  SELECT
    m."issueId",
    m."stampId",
    lpad((m."sortOrder"::bigint + 1000000000)::text, 12, '0') || m."stampId" || '/' AS "path",
    ARRAY[m."stampId"] AS "seen"
  FROM "issue_member" m
  JOIN "stamp" s ON s."id" = m."stampId"
  WHERE m."issueId" IN (SELECT "issueId" FROM "checklist" WHERE "issueId" IS NOT NULL AND NOT "ownOrder")
    AND (
      s."parentId" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "issue_member" p WHERE p."issueId" = m."issueId" AND p."stampId" = s."parentId"
      )
    )
  UNION ALL
  SELECT
    m."issueId",
    m."stampId",
    w."path" || lpad((m."sortOrder"::bigint + 1000000000)::text, 12, '0') || m."stampId" || '/',
    w."seen" || m."stampId"
  FROM "walk" w
  JOIN "stamp" s ON s."parentId" = w."stampId"
  JOIN "issue_member" m ON m."issueId" = w."issueId" AND m."stampId" = s."id"
  WHERE NOT m."stampId" = ANY(w."seen")
)
SELECT "issueId", "stampId", "path" FROM "walk";

-- A stamp on the checklist that the walk did not reach — one that is not a member of the issue —
-- reads after the issue's, keeping the order it had.
UPDATE "checklist_stamp" AS cs
SET "sortOrder" = ranked.rn
FROM (
  SELECT
    c."checklistId",
    c."stampId",
    (ROW_NUMBER() OVER (
      PARTITION BY c."checklistId"
      ORDER BY (o."path" IS NULL), o."path" COLLATE "C", c."sortOrder", c."stampId"
    ))::int - 1 AS rn
  FROM "checklist_stamp" c
  JOIN "checklist" k ON k."id" = c."checklistId" AND k."issueId" IS NOT NULL AND NOT k."ownOrder"
  LEFT JOIN "_issue_reading" o ON o."issueId" = k."issueId" AND o."stampId" = c."stampId"
) AS ranked
WHERE cs."checklistId" = ranked."checklistId" AND cs."stampId" = ranked."stampId";

DROP TABLE "_issue_reading";
