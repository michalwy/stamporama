CREATE TABLE "exchange_rate" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_rate_collectionId_fromCurrency_toCurrency_key" ON "exchange_rate"("collectionId", "fromCurrency", "toCurrency");

ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
