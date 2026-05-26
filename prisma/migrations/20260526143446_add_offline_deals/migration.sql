-- CreateTable
CREATE TABLE "OfflineRetailer" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "source" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineRetailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineDeal" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDealId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "imageUrl" TEXT,
    "category" TEXT,
    "priceEur" DOUBLE PRECISION,
    "originalPriceEur" DOUBLE PRECISION,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "postalCode" TEXT,
    "storeName" TEXT,
    "storeAddress" TEXT,
    "storeCity" TEXT,
    "storeLat" DOUBLE PRECISION,
    "storeLng" DOUBLE PRECISION,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfflineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfflineDeal_source_sourceDealId_key" ON "OfflineDeal"("source", "sourceDealId");

-- CreateIndex
CREATE INDEX "OfflineDeal_retailerId_idx" ON "OfflineDeal"("retailerId");

-- CreateIndex
CREATE INDEX "OfflineDeal_validUntil_idx" ON "OfflineDeal"("validUntil");

-- CreateIndex
CREATE INDEX "OfflineDeal_firstSeenAt_idx" ON "OfflineDeal"("firstSeenAt");

-- CreateIndex
CREATE INDEX "OfflineEvent_type_createdAt_idx" ON "OfflineEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "OfflineEvent_dealId_idx" ON "OfflineEvent"("dealId");

-- AddForeignKey
ALTER TABLE "OfflineDeal" ADD CONSTRAINT "OfflineDeal_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "OfflineRetailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineEvent" ADD CONSTRAINT "OfflineEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "OfflineDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
