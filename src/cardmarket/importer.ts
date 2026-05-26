import { readFile, stat } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { PRICE_GUIDE_PATH, PRODUCTS_PATH } from "./storage.js";

interface RawProduct {
  idProduct: number;
  name: string;
  idCategory: number;
  categoryName: string;
  idExpansion?: number | null;
  idMetacard?: number | null;
  dateAdded?: string | null;
}

interface RawPrice {
  idProduct: number;
  idCategory: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  ["avg-holo"]?: number | null;
  ["low-holo"]?: number | null;
  ["trend-holo"]?: number | null;
  ["avg1-holo"]?: number | null;
  ["avg7-holo"]?: number | null;
  ["avg30-holo"]?: number | null;
}

interface ProductsFile {
  version?: number;
  createdAt?: string;
  products?: RawProduct[];
}

interface PriceGuideFile {
  version?: number;
  createdAt?: string;
  priceGuides?: RawPrice[];
}

const CHUNK_SIZE = 500;

export interface ImportResult {
  count: number;
  sourceAt: Date | null;
}

function toDateOrNull(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function importProducts(): Promise<ImportResult> {
  const log = logger.child({ scope: "cm-import-products" });
  await stat(PRODUCTS_PATH);

  const raw = await readFile(PRODUCTS_PATH, "utf8");
  const parsed = JSON.parse(raw) as ProductsFile;
  const products = parsed.products ?? [];
  const sourceAt = toDateOrNull(parsed.createdAt);

  log.info({ count: products.length, sourceAt }, "products file parsed");

  let written = 0;
  for (const batch of chunk(products, CHUNK_SIZE)) {
    const now = new Date();
    const values = batch
      .filter((p) => Number.isInteger(p.idProduct) && p.name)
      .map(
        (p) =>
          Prisma.sql`(${p.idProduct}, ${p.name}, ${p.idCategory}, ${p.categoryName}, ${p.idExpansion ?? 0}, ${p.idMetacard ?? 0}, ${toDateOrNull(p.dateAdded ?? null)}, ${now}, ${now})`,
      );
    if (values.length === 0) continue;

    await prisma.$executeRaw`
      INSERT INTO "CardmarketProduct" ("idProduct","name","idCategory","categoryName","idExpansion","idMetacard","dateAdded","importedAt","updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("idProduct") DO UPDATE SET
        "name" = EXCLUDED."name",
        "idCategory" = EXCLUDED."idCategory",
        "categoryName" = EXCLUDED."categoryName",
        "idExpansion" = EXCLUDED."idExpansion",
        "idMetacard" = EXCLUDED."idMetacard",
        "dateAdded" = EXCLUDED."dateAdded",
        "updatedAt" = EXCLUDED."updatedAt"
    `;
    written += values.length;
  }

  log.info({ written }, "products upserted");
  return { count: written, sourceAt };
}

export async function importPrices(): Promise<ImportResult> {
  const log = logger.child({ scope: "cm-import-prices" });
  await stat(PRICE_GUIDE_PATH);

  const raw = await readFile(PRICE_GUIDE_PATH, "utf8");
  const parsed = JSON.parse(raw) as PriceGuideFile;
  const all = parsed.priceGuides ?? [];
  const sourceAt = toDateOrNull(parsed.createdAt);

  log.info({ count: all.length, sourceAt }, "price guide parsed");

  // Only import prices that we have a CardmarketProduct for — FK constraint
  // would otherwise reject every singles record (no Product row exists for
  // singles since products_nonsingles_6 only ships sealed).
  const productIds = await prisma.cardmarketProduct.findMany({
    select: { idProduct: true },
  });
  const knownProducts = new Set(productIds.map((p) => p.idProduct));
  const valid = all.filter((p) => Number.isInteger(p.idProduct) && knownProducts.has(p.idProduct));

  log.info(
    { totalInFile: all.length, validForImport: valid.length, dropped: all.length - valid.length },
    "filtered to sealed prices",
  );

  let written = 0;
  for (const batch of chunk(valid, CHUNK_SIZE)) {
    const now = new Date();
    const values = batch.map(
      (p) =>
        Prisma.sql`(${p.idProduct}, ${p.idCategory}, ${p.avg ?? null}, ${p.low ?? null}, ${p.trend ?? null}, ${p.avg1 ?? null}, ${p.avg7 ?? null}, ${p.avg30 ?? null}, ${p["avg-holo"] ?? null}, ${p["low-holo"] ?? null}, ${p["trend-holo"] ?? null}, ${p["avg1-holo"] ?? null}, ${p["avg7-holo"] ?? null}, ${p["avg30-holo"] ?? null}, ${now}, ${now})`,
    );
    if (values.length === 0) continue;

    await prisma.$executeRaw`
      INSERT INTO "CardmarketPrice" ("idProduct","idCategory","avg","low","trend","avg1","avg7","avg30","avgHolo","lowHolo","trendHolo","avg1Holo","avg7Holo","avg30Holo","importedAt","updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("idProduct") DO UPDATE SET
        "idCategory" = EXCLUDED."idCategory",
        "avg" = EXCLUDED."avg",
        "low" = EXCLUDED."low",
        "trend" = EXCLUDED."trend",
        "avg1" = EXCLUDED."avg1",
        "avg7" = EXCLUDED."avg7",
        "avg30" = EXCLUDED."avg30",
        "avgHolo" = EXCLUDED."avgHolo",
        "lowHolo" = EXCLUDED."lowHolo",
        "trendHolo" = EXCLUDED."trendHolo",
        "avg1Holo" = EXCLUDED."avg1Holo",
        "avg7Holo" = EXCLUDED."avg7Holo",
        "avg30Holo" = EXCLUDED."avg30Holo",
        "updatedAt" = EXCLUDED."updatedAt"
    `;
    written += values.length;
  }

  log.info({ written }, "prices upserted");
  return { count: written, sourceAt };
}

export async function recordSyncStatus(input: {
  products?: ImportResult;
  prices?: ImportResult;
  error?: string | null;
}): Promise<void> {
  const now = new Date();
  await prisma.cardmarketSyncStatus.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      productsLastSync: input.products ? now : null,
      productsLastSourceAt: input.products?.sourceAt ?? null,
      productsRecordCount: input.products?.count ?? null,
      pricesLastSync: input.prices ? now : null,
      pricesLastSourceAt: input.prices?.sourceAt ?? null,
      pricesRecordCount: input.prices?.count ?? null,
      lastError: input.error ?? null,
    },
    update: {
      ...(input.products
        ? {
            productsLastSync: now,
            productsLastSourceAt: input.products.sourceAt,
            productsRecordCount: input.products.count,
          }
        : {}),
      ...(input.prices
        ? {
            pricesLastSync: now,
            pricesLastSourceAt: input.prices.sourceAt,
            pricesRecordCount: input.prices.count,
          }
        : {}),
      lastError: input.error ?? null,
    },
  });
}
