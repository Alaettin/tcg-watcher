-- Sprach-Pendant-Feature aus Phase 4 wurde verworfen (JP/EN-Sets sind
-- eigenständige Sammlerprodukte, kein Arbitrage-Use-Case). Entferne
-- die zugehörige Self-Relation an CardmarketExpansion.

-- DropForeignKey
ALTER TABLE "CardmarketExpansion"
    DROP CONSTRAINT IF EXISTS "CardmarketExpansion_parentExpansionId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "CardmarketExpansion_parentExpansionId_idx";

-- DropColumn
ALTER TABLE "CardmarketExpansion" DROP COLUMN IF EXISTS "parentExpansionId";
