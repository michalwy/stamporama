CREATE TABLE "issue_catalog_number" (
    "issueId" TEXT NOT NULL,
    "catalogVendorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,

    CONSTRAINT "issue_catalog_number_pkey" PRIMARY KEY ("issueId","catalogVendorId")
);

ALTER TABLE "issue_catalog_number" ADD CONSTRAINT "issue_catalog_number_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_catalog_number" ADD CONSTRAINT "issue_catalog_number_catalogVendorId_fkey" FOREIGN KEY ("catalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
