CREATE TABLE "stamp_condition" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "stamp_condition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stamp_condition_collectionId_idx" ON "stamp_condition"("collectionId");

ALTER TABLE "stamp_condition" ADD CONSTRAINT "stamp_condition_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
