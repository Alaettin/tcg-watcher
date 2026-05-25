import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { logger } from "../src/lib/logger.js";

/**
 * One-shot migration: existing Products → Sets+Variants.
 *
 * Rules:
 *  - All Products whose id starts with "30th-" or "pokemon-day-2026" or "first-partner-"
 *    are bundled into Set "30th-anniversary" (preset, kept active).
 *  - Other Products become their own Set with a single Variant.
 *  - Existing Listings get setId + variantId backfilled.
 *  - Migration is idempotent: skips if Set already linked.
 */

const THIRTIETH_ID = "30th-anniversary";

function inferKind(category: string, displayName: string): string {
  const lower = (category + " " + displayName).toLowerCase();
  if (lower.includes("display")) return "display";
  if (lower.includes("elite trainer") || lower.includes("top trainer") || lower.includes(" etb")) return "etb";
  if (lower.includes("booster pack einzeln") || lower.includes("booster pack ") || lower.includes("einzelbooster")) return "booster";
  if (lower.includes("premium") || lower.includes("deck set") || lower.includes("deck")) return "premium-collection";
  if (lower.includes("tin")) return "tin";
  if (lower.includes("blister")) return "blister";
  if (lower.includes("bundle")) return "bundle";
  if (lower.includes("collection") || lower.includes("kollektion")) return "collection";
  if (lower.includes("card set")) return "collection";
  return category || "other";
}

function is30thProduct(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.startsWith("30th-") ||
    lower.startsWith("pokemon-day-2026") ||
    lower.startsWith("first-partner-")
  );
}

async function main() {
  const products = await prisma.product.findMany();
  logger.info({ count: products.length }, "found products to migrate");

  let setsCreated = 0;
  let variantsCreated = 0;
  let listingsUpdated = 0;
  const productToVariant = new Map<string, { setId: string; variantId: string }>();

  for (const p of products) {
    const targetSetId = is30thProduct(p.id) ? THIRTIETH_ID : p.id;
    let set = await prisma.set.findUnique({ where: { id: targetSetId } });
    if (!set) {
      set = await prisma.set.create({
        data: {
          id: targetSetId,
          name: is30thProduct(p.id) ? "Pokemon 30th Anniversary" : p.displayName,
          shortCode: is30thProduct(p.id) ? "30TH" : null,
          description: is30thProduct(p.id) ? "Pokemon 30. Geburtstag Jubiläums-Linie" : null,
          releaseDate: p.expectedReleaseDate,
          language: "DE",
          era: is30thProduct(p.id) ? "30th Anniversary" : null,
          searchTerms: p.searchTerms,
          negativeTerms: p.negativeTerms,
          active: true,
          isPreset: false,
        },
      });
      setsCreated++;
      logger.info({ setId: set.id, name: set.name }, "set created from product");
    } else if (is30thProduct(p.id)) {
      // Merge searchTerms into the existing 30th set (dedup)
      const merged = Array.from(new Set([...set.searchTerms, ...p.searchTerms]));
      const mergedNeg = Array.from(new Set([...set.negativeTerms, ...p.negativeTerms]));
      if (merged.length !== set.searchTerms.length || mergedNeg.length !== set.negativeTerms.length) {
        await prisma.set.update({
          where: { id: set.id },
          data: { searchTerms: merged, negativeTerms: mergedNeg },
        });
      }
    }

    const kind = inferKind(p.category, p.displayName);
    const variant = await prisma.variant.create({
      data: {
        setId: set.id,
        kind,
        displayName: p.displayName,
        uvpEur: p.uvpEur,
        uvpToleranceEur: p.uvpToleranceEur,
        ean: p.ean,
      },
    });
    variantsCreated++;
    productToVariant.set(p.id, { setId: set.id, variantId: variant.id });
  }

  // Backfill Listings
  for (const [productId, ref] of productToVariant) {
    const result = await prisma.listing.updateMany({
      where: { productId, setId: null },
      data: { setId: ref.setId, variantId: ref.variantId },
    });
    listingsUpdated += result.count;
  }

  logger.info(
    { setsCreated, variantsCreated, listingsUpdated },
    "migration complete",
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
