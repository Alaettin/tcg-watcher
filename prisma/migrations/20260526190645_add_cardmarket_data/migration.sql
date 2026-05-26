-- CreateTable
CREATE TABLE "CardmarketProduct" (
    "idProduct" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "idCategory" INTEGER NOT NULL,
    "categoryName" TEXT NOT NULL,
    "idExpansion" INTEGER NOT NULL,
    "idMetacard" INTEGER NOT NULL DEFAULT 0,
    "dateAdded" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardmarketProduct_pkey" PRIMARY KEY ("idProduct")
);

-- CreateTable
CREATE TABLE "CardmarketPrice" (
    "idProduct" INTEGER NOT NULL,
    "idCategory" INTEGER NOT NULL,
    "avg" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "trend" DOUBLE PRECISION,
    "avg1" DOUBLE PRECISION,
    "avg7" DOUBLE PRECISION,
    "avg30" DOUBLE PRECISION,
    "avgHolo" DOUBLE PRECISION,
    "lowHolo" DOUBLE PRECISION,
    "trendHolo" DOUBLE PRECISION,
    "avg1Holo" DOUBLE PRECISION,
    "avg7Holo" DOUBLE PRECISION,
    "avg30Holo" DOUBLE PRECISION,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardmarketPrice_pkey" PRIMARY KEY ("idProduct")
);

-- CreateTable
CREATE TABLE "CardmarketSyncStatus" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "productsLastSync" TIMESTAMP(3),
    "productsLastSourceAt" TIMESTAMP(3),
    "productsRecordCount" INTEGER,
    "pricesLastSync" TIMESTAMP(3),
    "pricesLastSourceAt" TIMESTAMP(3),
    "pricesRecordCount" INTEGER,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardmarketSyncStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardmarketProduct_idCategory_idx" ON "CardmarketProduct"("idCategory");

-- CreateIndex
CREATE INDEX "CardmarketProduct_idExpansion_idx" ON "CardmarketProduct"("idExpansion");

-- CreateIndex
CREATE INDEX "CardmarketProduct_name_idx" ON "CardmarketProduct"("name");

-- CreateIndex
CREATE INDEX "CardmarketPrice_idCategory_idx" ON "CardmarketPrice"("idCategory");

-- CreateIndex
CREATE INDEX "CardmarketPrice_trend_idx" ON "CardmarketPrice"("trend");

-- AddForeignKey
ALTER TABLE "CardmarketPrice" ADD CONSTRAINT "CardmarketPrice_idProduct_fkey" FOREIGN KEY ("idProduct") REFERENCES "CardmarketProduct"("idProduct") ON DELETE CASCADE ON UPDATE CASCADE;
