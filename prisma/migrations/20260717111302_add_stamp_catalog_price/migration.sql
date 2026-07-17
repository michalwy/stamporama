-- CreateTable
CREATE TABLE "stamp_catalog_price" (
    "stampId" TEXT NOT NULL,
    "catalogEditionId" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "stamp_catalog_price_pkey" PRIMARY KEY ("stampId","catalogEditionId")
);

-- AddForeignKey
ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_catalogEditionId_fkey" FOREIGN KEY ("catalogEditionId") REFERENCES "catalog_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
