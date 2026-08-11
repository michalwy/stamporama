-- `Want.priority` becomes its **rank** rather than its word (#532; ADR-0032 §5).
--
-- The want list is ordered by priority and paged on the server, so the database has to do the
-- sorting — and the only order Postgres can put a `text` column in is its spelling: `high` < `low`
-- < `normal`, which is not what anybody means by urgency. Ascending rank is descending urgency, so
-- a plain `ORDER BY` reads right and indexes with the rest of the ordering.
--
-- One column, not a word plus a rank beside it that has to agree with it. The vocabulary lives in
-- `want-rules.ts`; the word still travels on the wire, in the form and in the filter, and is mapped
-- at the domain boundary.

ALTER TABLE "want" ADD COLUMN "priorityRank" INTEGER NOT NULL DEFAULT 1;

UPDATE "want"
SET "priorityRank" = CASE "priority"
    WHEN 'high' THEN 0
    WHEN 'low' THEN 2
    ELSE 1
END;

ALTER TABLE "want" DROP COLUMN "priority";
ALTER TABLE "want" RENAME COLUMN "priorityRank" TO "priority";

-- The list's whole ordering, in order: open before closed, then urgency. `createdAt` is the last
-- tiebreak and is deliberately left off — it varies per row, so it would only lengthen the index.
CREATE INDEX "want_collectionId_closedAt_priority_idx"
    ON "want"("collectionId", "closedAt", "priority");
