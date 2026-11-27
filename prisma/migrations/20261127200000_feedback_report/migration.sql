-- #2720: reports sent with "Report a problem", from inside the app and from the pages shared with
-- customers. One new table and nothing else: no existing table, column or row is touched.
--
-- The account and the collection go NULL when either is deleted — a report outlives both.

CREATE TABLE "feedback_report" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "issueUrl" TEXT,
    "adminNote" TEXT,
    "contact" TEXT,
    "userId" TEXT,
    "collectionId" TEXT,
    "route" TEXT NOT NULL,
    "sharedPage" TEXT,
    "appVersion" TEXT NOT NULL,
    "userAgent" TEXT,
    "viewport" TEXT,
    "language" TEXT,
    "timeZone" TEXT,
    "theme" TEXT,
    "recentErrors" TEXT,

    CONSTRAINT "feedback_report_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedback_report_status_createdAt_idx" ON "feedback_report"("status", "createdAt");
CREATE INDEX "feedback_report_userId_idx" ON "feedback_report"("userId");
CREATE INDEX "feedback_report_collectionId_idx" ON "feedback_report"("collectionId");

ALTER TABLE "feedback_report" ADD CONSTRAINT "feedback_report_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "feedback_report" ADD CONSTRAINT "feedback_report_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
