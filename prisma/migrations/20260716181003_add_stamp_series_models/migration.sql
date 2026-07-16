-- AlterTable
ALTER TABLE "collection_area" ADD COLUMN     "primaryCatalogNameId" TEXT;

-- CreateTable
CREATE TABLE "stamp" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT,
    "issuedYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stamp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stamp_catalog_number" (
    "stampId" TEXT NOT NULL,
    "catalogNameId" TEXT NOT NULL,
    "number" TEXT NOT NULL,

    CONSTRAINT "stamp_catalog_number_pkey" PRIMARY KEY ("stampId","catalogNameId")
);

-- CreateTable
CREATE TABLE "collection_area_catalog" (
    "collectionAreaId" TEXT NOT NULL,
    "catalogNameId" TEXT NOT NULL,

    CONSTRAINT "collection_area_catalog_pkey" PRIMARY KEY ("collectionAreaId","catalogNameId")
);

-- CreateTable
CREATE TABLE "series" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "catalogNameId" TEXT NOT NULL,
    "name" TEXT,
    "isAutoCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_member" (
    "seriesId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "requiredVariantId" TEXT,

    CONSTRAINT "series_member_pkey" PRIMARY KEY ("seriesId","stampId")
);

-- AddForeignKey
ALTER TABLE "collection_area" ADD CONSTRAINT "collection_area_primaryCatalogNameId_fkey" FOREIGN KEY ("primaryCatalogNameId") REFERENCES "catalog_name"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_collection_area" ADD CONSTRAINT "stamp_collection_area_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp" ADD CONSTRAINT "stamp_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp" ADD CONSTRAINT "stamp_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "stamp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_catalog_number" ADD CONSTRAINT "stamp_catalog_number_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_catalog_number" ADD CONSTRAINT "stamp_catalog_number_catalogNameId_fkey" FOREIGN KEY ("catalogNameId") REFERENCES "catalog_name"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_area_catalog" ADD CONSTRAINT "collection_area_catalog_collectionAreaId_fkey" FOREIGN KEY ("collectionAreaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_area_catalog" ADD CONSTRAINT "collection_area_catalog_catalogNameId_fkey" FOREIGN KEY ("catalogNameId") REFERENCES "catalog_name"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_catalogNameId_fkey" FOREIGN KEY ("catalogNameId") REFERENCES "catalog_name"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_requiredVariantId_fkey" FOREIGN KEY ("requiredVariantId") REFERENCES "stamp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
