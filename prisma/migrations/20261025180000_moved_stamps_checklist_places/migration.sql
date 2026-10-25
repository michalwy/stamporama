-- A stamp moved to another issue leaves the old issue's checklists (#2184). Until now the screen's
-- *Move to another issue…* left it on them, counted in a set of an issue it is no longer in, and on
-- none of the new issue's. This cleans up the stamps already moved, by the rule the move itself now
-- follows (#2169):
--
-- - a stamp on a checklist of an issue it is not a member of is taken off it; a checklist spanning
--   issues (`issueId` null) belongs to no issue and keeps it;
-- - such a stamp joins its own issue's first standard checklist, at its end, when it is on none of
--   that issue's checklists — the stamp at the top of its tree there always, a variant only when one
--   of the places it left was on a standard checklist (2026-10-25, #2169). The issue gains a standard
--   checklist named after it when it has none, ahead of any specialised one, as `ensureIssueChecklist`
--   makes it.

CREATE TEMPORARY TABLE "_stray_checklist_place" AS
SELECT cs."checklistId", cs."stampId", c."collectionId", c."kind"
FROM "checklist_stamp" cs
JOIN "checklist" c ON c."id" = cs."checklistId"
WHERE c."issueId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "issue_member" m
    WHERE m."issueId" = c."issueId" AND m."stampId" = cs."stampId"
  );

DELETE FROM "checklist_stamp" cs
USING "_stray_checklist_place" s
WHERE cs."checklistId" = s."checklistId" AND cs."stampId" = s."stampId";

CREATE TEMPORARY TABLE "_rejoining_stamp" AS
SELECT m."issueId", m."stampId", m."sortOrder", i."collectionId"
FROM "issue_member" m
JOIN "issue" i ON i."id" = m."issueId"
JOIN "stamp" st ON st."id" = m."stampId"
WHERE EXISTS (
    SELECT 1 FROM "_stray_checklist_place" s
    WHERE s."stampId" = m."stampId" AND s."collectionId" = i."collectionId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "checklist_stamp" cs
    JOIN "checklist" c ON c."id" = cs."checklistId"
    WHERE c."issueId" = m."issueId" AND cs."stampId" = m."stampId"
  )
  AND (
    st."parentId" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "issue_member" p
      WHERE p."issueId" = m."issueId" AND p."stampId" = st."parentId"
    )
    OR EXISTS (
      SELECT 1 FROM "_stray_checklist_place" s
      WHERE s."stampId" = m."stampId" AND s."collectionId" = i."collectionId" AND s."kind" = 'standard'
    )
  );

INSERT INTO "checklist" ("id", "collectionId", "issueId", "name", "sortOrder", "kind")
SELECT gen_random_uuid()::text, i."collectionId", i."id",
       COALESCE(NULLIF(TRIM(i."name"), ''), 'Complete set'),
       COALESCE(
         (SELECT MIN(c."sortOrder") - 1 FROM "checklist" c
          WHERE c."issueId" = i."id" AND c."collectionId" = i."collectionId"),
         0
       ),
       'standard'
FROM "issue" i
WHERE i."id" IN (SELECT "issueId" FROM "_rejoining_stamp")
  AND NOT EXISTS (
    SELECT 1 FROM "checklist" c
    WHERE c."issueId" = i."id" AND c."collectionId" = i."collectionId" AND c."kind" = 'standard'
  );

WITH "target" AS (
  SELECT DISTINCT ON (c."issueId") c."issueId", c."id"
  FROM "checklist" c
  JOIN "issue" i ON i."id" = c."issueId" AND i."collectionId" = c."collectionId"
  WHERE c."kind" = 'standard' AND c."issueId" IN (SELECT "issueId" FROM "_rejoining_stamp")
  ORDER BY c."issueId", c."sortOrder", c."createdAt"
)
INSERT INTO "checklist_stamp" ("checklistId", "stampId", "sortOrder")
SELECT t."id", r."stampId",
       COALESCE((SELECT MAX(cs."sortOrder") FROM "checklist_stamp" cs WHERE cs."checklistId" = t."id"), -1)
         + ROW_NUMBER() OVER (PARTITION BY t."id" ORDER BY r."sortOrder", r."stampId")
FROM "_rejoining_stamp" r
JOIN "target" t ON t."issueId" = r."issueId"
ON CONFLICT DO NOTHING;

DROP TABLE "_rejoining_stamp";
DROP TABLE "_stray_checklist_place";
