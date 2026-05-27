-- Cardmarket Watchlist + Alerts (cm.md Phase 3)
-- Single-user Watchlist mit Schwellwert-Alerts auf trend und Signal-Flip-
-- Alerts. 24h-Cooldown via lastAlertSentAt.

-- AlterTable: SyncLog bekommt zusätzlichen Counter für Watchlist-Alerts.
ALTER TABLE "CardmarketSyncLog" ADD COLUMN "watchlistAlertsCount" INTEGER;

-- CreateTable
CREATE TABLE "CardmarketWatchlistItem" (
    "id" BIGSERIAL NOT NULL,
    "idProduct" INTEGER NOT NULL,
    "note" TEXT,
    "alertBelowTrend" DOUBLE PRECISION,
    "alertAboveTrend" DOUBLE PRECISION,
    "alertOnSignalFlip" BOOLEAN NOT NULL DEFAULT true,
    "lastAlertSentAt" TIMESTAMP(3),
    "lastNotifiedRecommendation" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardmarketWatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardmarketWatchlistItem_idProduct_key"
    ON "CardmarketWatchlistItem"("idProduct");

-- CreateIndex
CREATE INDEX "CardmarketWatchlistItem_addedAt_idx"
    ON "CardmarketWatchlistItem"("addedAt" DESC);

-- AddForeignKey
ALTER TABLE "CardmarketWatchlistItem"
    ADD CONSTRAINT "CardmarketWatchlistItem_idProduct_fkey"
    FOREIGN KEY ("idProduct") REFERENCES "CardmarketProduct"("idProduct")
    ON DELETE CASCADE ON UPDATE CASCADE;
