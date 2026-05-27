-- Cardmarket Market-Intelligence (cm.md Phase 1 + 2)
-- Erweitert das bestehende CardmarketProduct/Price-Schema um:
--   * CardmarketPriceSnapshot — append-only Tages-Historie (Moat)
--   * CardmarketSignal — vorberechnete L/M/Δ7/Δ30 + recommendation pro Tag
--   * CardmarketExpansion — Set-Mapping inkl. Sprach-Info
--   * CardmarketSyncLog — Run-History
--   * CardmarketSetSignalDaily — Materialized View für Set-Kontext

-- CreateTable
CREATE TABLE "CardmarketPriceSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "idProduct" INTEGER NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "low" DOUBLE PRECISION,
    "avg" DOUBLE PRECISION,
    "trend" DOUBLE PRECISION,
    "avg1" DOUBLE PRECISION,
    "avg7" DOUBLE PRECISION,
    "avg30" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardmarketPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardmarketSignal" (
    "idProduct" INTEGER NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "lScore" DOUBLE PRECISION,
    "mScore" DOUBLE PRECISION,
    "delta7" DOUBLE PRECISION,
    "delta30" DOUBLE PRECISION,
    "movementClass" TEXT,
    "recommendation" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "reasoningLines" JSONB NOT NULL,
    "sampleQuality" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardmarketSignal_pkey" PRIMARY KEY ("idProduct","snapshotDate")
);

-- CreateTable
CREATE TABLE "CardmarketExpansion" (
    "idExpansion" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "releaseDate" DATE,
    "parentExpansionId" INTEGER,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardmarketExpansion_pkey" PRIMARY KEY ("idExpansion")
);

-- CreateTable
CREATE TABLE "CardmarketSyncLog" (
    "id" BIGSERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "productsCount" INTEGER,
    "snapshotsCount" INTEGER,
    "signalsCount" INTEGER,
    "expansionsCount" INTEGER,
    "status" TEXT NOT NULL,
    "errorMsg" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "CardmarketSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardmarketPriceSnapshot_idProduct_snapshotDate_key"
    ON "CardmarketPriceSnapshot"("idProduct", "snapshotDate");

-- CreateIndex
CREATE INDEX "CardmarketPriceSnapshot_snapshotDate_idx"
    ON "CardmarketPriceSnapshot"("snapshotDate");

-- CreateIndex
CREATE INDEX "CardmarketPriceSnapshot_idProduct_snapshotDate_idx"
    ON "CardmarketPriceSnapshot"("idProduct", "snapshotDate" DESC);

-- CreateIndex
CREATE INDEX "CardmarketSignal_snapshotDate_recommendation_idx"
    ON "CardmarketSignal"("snapshotDate", "recommendation");

-- CreateIndex
CREATE INDEX "CardmarketSignal_snapshotDate_delta7_idx"
    ON "CardmarketSignal"("snapshotDate", "delta7");

-- CreateIndex
CREATE INDEX "CardmarketSignal_snapshotDate_mScore_idx"
    ON "CardmarketSignal"("snapshotDate", "mScore");

-- CreateIndex
CREATE INDEX "CardmarketSignal_idProduct_snapshotDate_idx"
    ON "CardmarketSignal"("idProduct", "snapshotDate" DESC);

-- CreateIndex
CREATE INDEX "CardmarketExpansion_parentExpansionId_idx"
    ON "CardmarketExpansion"("parentExpansionId");

-- CreateIndex
CREATE INDEX "CardmarketExpansion_language_idx"
    ON "CardmarketExpansion"("language");

-- CreateIndex
CREATE INDEX "CardmarketSyncLog_startedAt_idx"
    ON "CardmarketSyncLog"("startedAt" DESC);

-- AddForeignKey
ALTER TABLE "CardmarketPriceSnapshot"
    ADD CONSTRAINT "CardmarketPriceSnapshot_idProduct_fkey"
    FOREIGN KEY ("idProduct") REFERENCES "CardmarketProduct"("idProduct")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardmarketSignal"
    ADD CONSTRAINT "CardmarketSignal_idProduct_fkey"
    FOREIGN KEY ("idProduct") REFERENCES "CardmarketProduct"("idProduct")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardmarketExpansion"
    ADD CONSTRAINT "CardmarketExpansion_parentExpansionId_fkey"
    FOREIGN KEY ("parentExpansionId") REFERENCES "CardmarketExpansion"("idExpansion")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Materialized View: Set-Kontext (Median-L, Median-Δ7, Volatilität pro Set/Tag)
-- Refresh am Ende von Step 5 im Sync-Job (REFRESH MATERIALIZED VIEW CONCURRENTLY).
CREATE MATERIALIZED VIEW "CardmarketSetSignalDaily" AS
SELECT
  p."idExpansion",
  s."snapshotDate",
  COUNT(*)::int AS "productCount",
  percentile_cont(0.5) WITHIN GROUP (ORDER BY s."lScore") AS "medianL",
  percentile_cont(0.5) WITHIN GROUP (ORDER BY s."delta7") AS "medianDelta7",
  stddev_pop(s."delta7") AS "volatilityDelta7"
FROM "CardmarketSignal" s
JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
GROUP BY p."idExpansion", s."snapshotDate";

CREATE UNIQUE INDEX "CardmarketSetSignalDaily_idExpansion_snapshotDate_key"
    ON "CardmarketSetSignalDaily" ("idExpansion", "snapshotDate");
