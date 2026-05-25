-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('NEW_LISTING', 'RESTOCK', 'PRICE_DROP', 'RESALE_DEAL', 'WENT_OUT_OF_STOCK');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "expectedReleaseDate" TIMESTAMP(3),
    "uvpEur" DOUBLE PRECISION,
    "uvpToleranceEur" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "searchTerms" TEXT[],
    "negativeTerms" TEXT[],
    "ean" TEXT,
    "minResalePriceEur" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 120,
    "dropDayIntervalSeconds" INTEGER NOT NULL DEFAULT 10,
    "lastSuccessfulRun" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceEur" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "ListingStatus" NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "detail" JSONB NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_productId_status_idx" ON "Listing"("productId", "status");

-- CreateIndex
CREATE INDEX "Listing_seenAt_idx" ON "Listing"("seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_shopId_externalId_key" ON "Listing"("shopId", "externalId");

-- CreateIndex
CREATE INDEX "Event_type_createdAt_idx" ON "Event"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
