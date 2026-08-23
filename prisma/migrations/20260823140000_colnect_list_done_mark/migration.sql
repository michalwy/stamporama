-- "Done on Colnect" (#686) — the one table the report needs that #684 did not build.
--
-- The report's rows are differences, and a collector working through them acts on Colnect in
-- another tab: they add the missing item, delete the extra one, correct the quantity. Nothing here
-- can verify that — the app never talks to Colnect — so the row is *hidden on the collector's
-- claim*, and the claim is worth exactly as long as the file it was made against.
--
-- Hence the asymmetry with `colnect_list_decision`, which is the whole reason this is its own
-- table rather than a column beside it. A **decision** is *this difference is fine* — a judgement
-- about this collection, hanging off the mapping, surviving every re-import. A **done mark** is
-- *I have already fixed this on Colnect* — a claim about the state of Colnect, hanging off the
-- snapshot, and a fresh export is the only thing that can check it. A row that comes back after
-- the next import was not actually done, and the report has to say so rather than keep hiding it
-- behind a claim that turned out false. Cascading off the snapshot is what makes that automatic:
-- the import replaces the snapshot, and every claim made against the old one goes with it.
--
-- `colnectId` rather than a stamp id, for `colnect_list_decision`'s reason: it is the only
-- vocabulary both sides share, and a difference exists precisely where one of the two sides has no
-- row to point at. `kind` is part of the key because a row's difference can change between imports
-- — a quantity that was wrong becomes a grade that is wrong — and a claim about the first must not
-- silently hide the second.
CREATE TABLE "colnect_list_done_mark" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "colnectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colnect_list_done_mark_pkey" PRIMARY KEY ("id")
);

-- One claim per difference. Marking a row done twice is the same claim, not a second one.
CREATE UNIQUE INDEX "colnect_list_done_mark_snapshotId_colnectId_kind_key"
    ON "colnect_list_done_mark"("snapshotId", "colnectId", "kind");
-- The lookup the report does: every claim standing against the snapshot it is reading.
CREATE INDEX "colnect_list_done_mark_snapshotId_idx" ON "colnect_list_done_mark"("snapshotId");

ALTER TABLE "colnect_list_done_mark" ADD CONSTRAINT "colnect_list_done_mark_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "colnect_list_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
