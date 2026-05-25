-- DropForeignKey
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_productId_fkey";

-- AlterTable
ALTER TABLE "Listing" ALTER COLUMN "productId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
