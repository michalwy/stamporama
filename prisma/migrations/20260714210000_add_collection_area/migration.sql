-- CreateTable
CREATE TABLE "collection_area" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "catalogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stamp_collection_area" (
    "stampId" TEXT NOT NULL,
    "collectionAreaId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "stamp_collection_area_pkey" PRIMARY KEY ("stampId","collectionAreaId")
);

-- AddForeignKey
ALTER TABLE "collection_area" ADD CONSTRAINT "collection_area_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_area" ADD CONSTRAINT "collection_area_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "collection_area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_collection_area" ADD CONSTRAINT "stamp_collection_area_collectionAreaId_fkey" FOREIGN KEY ("collectionAreaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
