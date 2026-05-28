-- Cardmarket Artikel-Blacklist. Ausgeblendete Produkte verschwinden aus allen
-- Artikel-Listen, der Sync sammelt aber weiter Snapshots + Signale für sie.

-- CreateTable
CREATE TABLE "CardmarketBlacklistItem" (
    "id" BIGSERIAL NOT NULL,
    "idProduct" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardmarketBlacklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardmarketBlacklistItem_idProduct_key"
    ON "CardmarketBlacklistItem"("idProduct");

-- CreateIndex
CREATE INDEX "CardmarketBlacklistItem_addedAt_idx"
    ON "CardmarketBlacklistItem"("addedAt" DESC);

-- AddForeignKey
ALTER TABLE "CardmarketBlacklistItem"
    ADD CONSTRAINT "CardmarketBlacklistItem_idProduct_fkey"
    FOREIGN KEY ("idProduct") REFERENCES "CardmarketProduct"("idProduct")
    ON DELETE CASCADE ON UPDATE CASCADE;
