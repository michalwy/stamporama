-- Pictures sent with a feedback report (#2727): screenshots, kept as they came with a thumbnail, in
-- the shape of a sale's files (#2198). A new table, so there is nothing to carry over. The cascade
-- from a report drops the rows only; the bytes are the domain's (`feedback.ts`).

CREATE TABLE "feedback_attachment" (
    "id" TEXT NOT NULL,
    "feedbackReportId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageBackend" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedback_attachment_feedbackReportId_createdAt_idx" ON "feedback_attachment"("feedbackReportId", "createdAt");

ALTER TABLE "feedback_attachment" ADD CONSTRAINT "feedback_attachment_feedbackReportId_fkey" FOREIGN KEY ("feedbackReportId") REFERENCES "feedback_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
