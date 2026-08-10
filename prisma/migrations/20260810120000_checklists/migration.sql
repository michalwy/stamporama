-- Checklists (#531; ADR-0031). A checklist is a named list of stamps that counts as one complete
-- unit — the collecting goal, as against the issue, which is the publication event. They used to
-- be welded together by `issue_member.requiredForCompleteness`: one boolean, so one issue had
-- exactly one complete set. Basic vs specialized, perforated vs imperforate and tabbed vs plain
-- are all one publication with two goals, and none of them fit.
--
-- This is a DATA migration. Every issue that has at least one required member becomes exactly one
-- checklist carrying those members, named after the issue — lossless, and the collection reads
-- afterwards exactly as it did before. Then the boolean goes: keeping it as "the default target"
-- would mean two mechanisms doing one job.

CREATE TABLE "checklist" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    -- Null = spans issues (no home yet; the editor built with this migration is the issue-scoped
    -- one). Not null = this issue's own goal. Same nullable-anchor idiom as `stamp_format_factor`.
    "issueId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "checklist_collectionId_idx" ON "checklist"("collectionId");
CREATE INDEX "checklist_issueId_sortOrder_idx" ON "checklist"("issueId", "sortOrder");

ALTER TABLE "checklist" ADD CONSTRAINT "checklist_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checklist" ADD CONSTRAINT "checklist_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Membership is required-ness: a stamp in no checklist is the optional extra the old `false` meant.
CREATE TABLE "checklist_stamp" (
    "checklistId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,

    CONSTRAINT "checklist_stamp_pkey" PRIMARY KEY ("checklistId", "stampId")
);

CREATE INDEX "checklist_stamp_stampId_idx" ON "checklist_stamp"("stampId");

ALTER TABLE "checklist_stamp" ADD CONSTRAINT "checklist_stamp_checklistId_fkey"
    FOREIGN KEY ("checklistId") REFERENCES "checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checklist_stamp" ADD CONSTRAINT "checklist_stamp_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One checklist per issue that had any required member. Named after the issue, because that is what
-- the single target *was* — an unnamed issue falls back to "Complete set", which is what the row
-- already reads as on screen.
INSERT INTO "checklist" ("id", "collectionId", "issueId", "name", "sortOrder")
SELECT gen_random_uuid()::text, i."collectionId", i."id",
       COALESCE(NULLIF(TRIM(i."name"), ''), 'Complete set'), 0
FROM "issue" i
WHERE EXISTS (
    SELECT 1 FROM "issue_member" m
    WHERE m."issueId" = i."id" AND m."requiredForCompleteness"
);

INSERT INTO "checklist_stamp" ("checklistId", "stampId")
SELECT c."id", m."stampId"
FROM "checklist" c
JOIN "issue_member" m ON m."issueId" = c."issueId" AND m."requiredForCompleteness";

ALTER TABLE "issue_member" DROP COLUMN "requiredForCompleteness";
