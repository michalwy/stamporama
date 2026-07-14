-- CreateTable
CREATE TABLE "catalog_vendor" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,

    CONSTRAINT "catalog_vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_name" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "abbreviation" TEXT,

    CONSTRAINT "catalog_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_edition" (
    "id" TEXT NOT NULL,
    "catalogNameId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "catalog_edition_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "catalog_vendor" ADD CONSTRAINT "catalog_vendor_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_name" ADD CONSTRAINT "catalog_name_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "catalog_vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_edition" ADD CONSTRAINT "catalog_edition_catalogNameId_fkey" FOREIGN KEY ("catalogNameId") REFERENCES "catalog_name"("id") ON DELETE CASCADE ON UPDATE CASCADE;
