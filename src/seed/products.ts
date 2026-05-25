import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const ProductSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  category: z.string(),
  expectedReleaseDate: z.string().nullable().optional(),
  uvpEur: z.number().nullable(),
  uvpToleranceEur: z.number(),
  searchTerms: z.array(z.string()),
  negativeTerms: z.array(z.string()),
  ean: z.string().nullable(),
  minResalePriceEur: z.number().nullable(),
});

const WatchlistSchema = z.array(ProductSchema);

export type WatchlistProduct = z.infer<typeof ProductSchema>;

export async function loadWatchlist(): Promise<WatchlistProduct[]> {
  const path = resolve(process.cwd(), "config/watchlist.json");
  const raw = await readFile(path, "utf-8");
  return WatchlistSchema.parse(JSON.parse(raw));
}

export async function seedProducts(): Promise<WatchlistProduct[]> {
  const products = await loadWatchlist();
  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        displayName: p.displayName,
        category: p.category,
        expectedReleaseDate: p.expectedReleaseDate ? new Date(p.expectedReleaseDate) : null,
        uvpEur: p.uvpEur,
        uvpToleranceEur: p.uvpToleranceEur,
        searchTerms: p.searchTerms,
        negativeTerms: p.negativeTerms,
        ean: p.ean,
        minResalePriceEur: p.minResalePriceEur,
      },
      update: {
        displayName: p.displayName,
        category: p.category,
        expectedReleaseDate: p.expectedReleaseDate ? new Date(p.expectedReleaseDate) : null,
        uvpEur: p.uvpEur,
        uvpToleranceEur: p.uvpToleranceEur,
        searchTerms: p.searchTerms,
        negativeTerms: p.negativeTerms,
        ean: p.ean,
        minResalePriceEur: p.minResalePriceEur,
      },
    });
  }
  logger.info({ count: products.length }, "products seeded");
  return products;
}
