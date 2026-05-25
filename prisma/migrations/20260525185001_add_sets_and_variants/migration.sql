-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "setId" TEXT,
ADD COLUMN     "variantId" TEXT;

-- CreateTable
CREATE TABLE "Set" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortCode" TEXT,
    "description" TEXT,
    "releaseDate" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'DE',
    "era" TEXT,
    "searchTerms" TEXT[],
    "negativeTerms" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT false,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "uvpEur" DOUBLE PRECISION,
    "uvpToleranceEur" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "ean" TEXT,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Set_active_idx" ON "Set"("active");

-- CreateIndex
CREATE INDEX "Set_era_idx" ON "Set"("era");

-- CreateIndex
CREATE INDEX "Variant_setId_idx" ON "Variant"("setId");

-- CreateIndex
CREATE INDEX "Listing_setId_status_idx" ON "Listing"("setId", "status");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
