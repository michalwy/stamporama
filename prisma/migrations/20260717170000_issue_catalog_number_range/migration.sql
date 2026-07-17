ALTER TABLE "issue_catalog_number" RENAME COLUMN "number" TO "firstNumber";
ALTER TABLE "issue_catalog_number" ADD COLUMN "lastNumber" TEXT;
