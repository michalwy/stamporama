CREATE TABLE "certificate_status" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "certificate_status_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "certificate_status_collectionId_idx" ON "certificate_status"("collectionId");

ALTER TABLE "certificate_status" ADD CONSTRAINT "certificate_status_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
