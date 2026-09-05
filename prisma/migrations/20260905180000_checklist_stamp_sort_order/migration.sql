-- Manual order of the stamps on a checklist (#764).
--
-- A checklist had no order of its own: `checklist_stamp` was a bare join, so every surface that
-- listed one fell back to the catalog sort key — right almost always, and wrong exactly where a
-- catalogue's numbering does not match how the set is laid out. Album pages (#755) print a
-- checklist as a row of boxes, and the row *is* the order.
--
-- The same mechanism as `issue_member.sortOrder` (#549) one level over, and simpler: a checklist is
-- flat, so there are no sibling groups whose values never compare, and a reorder densely renumbers
-- the whole list.
--
-- Backfilled in **catalog-sort order** — `stamp.primaryCatalogSortKey` (ADR-0014), the very fallback
-- every reader used until now, with the name and the id behind it so a checklist of number-less
-- stamps still gets a stable sequence. Nothing moves the day the column arrives.

ALTER TABLE "checklist_stamp" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "checklist_stamp" AS cs
SET "sortOrder" = ranked.rn
FROM (
  SELECT
    c."checklistId",
    c."stampId",
    (ROW_NUMBER() OVER (
      PARTITION BY c."checklistId"
      ORDER BY s."primaryCatalogSortKey" ASC NULLS LAST, s."name" ASC NULLS LAST, c."stampId" ASC
    ))::int - 1 AS rn
  FROM "checklist_stamp" c
  JOIN "stamp" s ON s."id" = c."stampId"
) AS ranked
WHERE cs."checklistId" = ranked."checklistId" AND cs."stampId" = ranked."stampId";

CREATE INDEX "checklist_stamp_checklistId_sortOrder_idx" ON "checklist_stamp"("checklistId", "sortOrder");
