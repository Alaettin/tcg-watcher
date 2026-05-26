-- CreateTable
CREATE TABLE "SetList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetListItem" (
    "setListId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetListItem_pkey" PRIMARY KEY ("setListId", "setId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetList_name_key" ON "SetList"("name");

-- CreateIndex
CREATE INDEX "SetListItem_setId_idx" ON "SetListItem"("setId");

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "setListId" TEXT;

-- CreateIndex
CREATE INDEX "Shop_setListId_idx" ON "Shop"("setListId");

-- AddForeignKey
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_setListId_fkey" FOREIGN KEY ("setListId") REFERENCES "SetList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetListItem" ADD CONSTRAINT "SetListItem_setListId_fkey" FOREIGN KEY ("setListId") REFERENCES "SetList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetListItem" ADD CONSTRAINT "SetListItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
