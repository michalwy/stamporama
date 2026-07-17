-- DropForeignKey (must happen before table renames)
ALTER TABLE "series_member" DROP CONSTRAINT "series_member_requiredVariantId_fkey";
ALTER TABLE "series_member" DROP CONSTRAINT "series_member_seriesId_fkey";
ALTER TABLE "series_member" DROP CONSTRAINT "series_member_stampId_fkey";
ALTER TABLE "series" DROP CONSTRAINT "series_collectionId_fkey";
ALTER TABLE "series" DROP CONSTRAINT "series_catalogNameId_fkey";

-- RenameTable
ALTER TABLE "series" RENAME TO "issue";
ALTER TABLE "series_member" RENAME TO "issue_member";

-- RenamePrimaryKey
ALTER TABLE "issue" RENAME CONSTRAINT "series_pkey" TO "issue_pkey";
ALTER TABLE "issue_member" RENAME CONSTRAINT "series_member_pkey" TO "issue_member_pkey";

-- RenameColumn
ALTER TABLE "issue_member" RENAME COLUMN "seriesId" TO "issueId";

-- DropColumn
ALTER TABLE "issue_member" DROP COLUMN "requiredVariantId";

-- AddColumn
ALTER TABLE "issue_member" ADD COLUMN "requiredForCompleteness" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "issue" ADD CONSTRAINT "issue_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue" ADD CONSTRAINT "issue_catalogNameId_fkey" FOREIGN KEY ("catalogNameId") REFERENCES "catalog_name"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_member" ADD CONSTRAINT "issue_member_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_member" ADD CONSTRAINT "issue_member_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
