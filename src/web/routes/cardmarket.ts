import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import multer from "multer";
import { writeFile } from "node:fs/promises";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import {
  PRICE_GUIDE_PATH,
  PRODUCTS_PATH,
  ensureCardmarketDir,
} from "../../cardmarket/storage.js";
import { triggerCardmarketSyncNow } from "../../cardmarket/scheduler.js";
import { runExpansionsScrape } from "../../cardmarket/expansionsImporter.js";

export const cardmarketRouter = Router();

// Wiederverwendbare SQL-Klausel: schließt geblacklistete Produkte aus
// Artikel-Listen aus. Setzt voraus, dass die Query "CardmarketProduct" als
// Alias `p` joint. Wird per AND an die jeweilige WHERE-Klausel gehängt.
const NOT_BLACKLISTED = Prisma.sql`p."idProduct" NOT IN (SELECT "idProduct" FROM "CardmarketBlacklistItem")`;

const ListQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  category: z.coerce.number().int().optional(),
  expansion: z.coerce.number().int().optional(),
  sort: z.enum(["trend", "low", "avg", "name", "updatedAt"]).default("trend"),
  order: z.enum(["asc", "desc"]).default("desc"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

cardmarketRouter.get("/cardmarket/products", async (req, res, next) => {
  try {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query", issues: parsed.error.issues });
      return;
    }
    const { q, category, expansion, sort, order, offset, limit } = parsed.data;

    // is: null auf einer 1-1-Relation = Produkte ohne Blacklist-Eintrag.
    const where: Prisma.CardmarketProductWhereInput = { blacklistItem: { is: null } };
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (category) where.idCategory = category;
    if (expansion) where.idExpansion = expansion;

    let orderBy: Prisma.CardmarketProductOrderByWithRelationInput;
    if (sort === "name") {
      orderBy = { name: order };
    } else if (sort === "updatedAt") {
      orderBy = { updatedAt: order };
    } else {
      orderBy = { price: { [sort]: order } };
    }

    const [total, results] = await Promise.all([
      prisma.cardmarketProduct.count({ where }),
      prisma.cardmarketProduct.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        include: { price: true },
      }),
    ]);

    res.json({ results, total, offset, limit });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.get("/cardmarket/products/:idProduct", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    const product = await prisma.cardmarketProduct.findUnique({
      where: { idProduct: id },
      include: { price: true },
    });
    if (!product) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.get("/cardmarket/categories", async (_req, res, next) => {
  try {
    const rows = await prisma.cardmarketProduct.groupBy({
      by: ["idCategory", "categoryName"],
      _count: { idProduct: true },
      orderBy: { _count: { idProduct: "desc" } },
    });
    res.json(
      rows.map((r) => ({
        idCategory: r.idCategory,
        categoryName: r.categoryName,
        productCount: r._count.idProduct,
      })),
    );
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.get("/cardmarket/expansions", async (_req, res, next) => {
  try {
    // Join mit CardmarketExpansion-Namen, fallback auf "Set {id}" wenn fehlend.
    const rows = await prisma.$queryRaw<
      { idExpansion: number; productCount: number; name: string | null; language: string | null }[]
    >`
      SELECT
        p."idExpansion",
        COUNT(*)::int AS "productCount",
        e."name",
        e."language"
      FROM "CardmarketProduct" p
      LEFT JOIN "CardmarketExpansion" e ON e."idExpansion" = p."idExpansion"
      GROUP BY p."idExpansion", e."name", e."language"
      ORDER BY COUNT(*) DESC
    `;
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.get("/cardmarket/sync-status", async (_req, res, next) => {
  try {
    const status = await prisma.cardmarketSyncStatus.findUnique({
      where: { id: "singleton" },
    });
    res.json(status ?? null);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// Phase 1 + 2 — Signal-Endpoints (cm.md)
// ============================================================================

/** Aktuelles snapshotDate aus CardmarketSignal — Cache am Request-Start. */
async function getLatestSignalDate(): Promise<Date | null> {
  const row = await prisma.cardmarketSignal.findFirst({
    select: { snapshotDate: true },
    orderBy: { snapshotDate: "desc" },
  });
  return row?.snapshotDate ?? null;
}

const SignalsTodayQuery = z.object({
  recommendation: z.enum(["GREEN", "AMBER", "RED", "NEUTRAL"]).optional(),
  category: z.coerce.number().int().optional(),
  expansion: z.coerce.number().int().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  minQuality: z.coerce.number().min(0).max(1).optional(),
  sort: z.enum(["delta7", "delta30", "lScore", "mScore", "trend", "name"]).default("delta7"),
  order: z.enum(["asc", "desc"]).default("desc"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

cardmarketRouter.get("/cardmarket/signals/today", async (req, res, next) => {
  try {
    const parsed = SignalsTodayQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query", issues: parsed.error.issues });
      return;
    }
    const { recommendation, category, expansion, q, minQuality, sort, order, offset, limit } =
      parsed.data;

    const latest = await getLatestSignalDate();
    if (!latest) {
      res.json({ results: [], total: 0, snapshotDate: null, offset, limit });
      return;
    }

    const sortMap: Record<typeof sort, Prisma.Sql> = {
      delta7: Prisma.sql`s."delta7"`,
      delta30: Prisma.sql`s."delta30"`,
      lScore: Prisma.sql`s."lScore"`,
      mScore: Prisma.sql`s."mScore"`,
      trend: Prisma.sql`pr."trend"`,
      name: Prisma.sql`p."name"`,
    };
    const orderSql = order === "asc" ? Prisma.sql`ASC NULLS LAST` : Prisma.sql`DESC NULLS LAST`;

    const filters: Prisma.Sql[] = [
      Prisma.sql`s."snapshotDate" = ${latest}::date`,
      NOT_BLACKLISTED,
    ];
    if (recommendation) filters.push(Prisma.sql`s."recommendation" = ${recommendation}`);
    if (category) filters.push(Prisma.sql`p."idCategory" = ${category}`);
    if (expansion) filters.push(Prisma.sql`p."idExpansion" = ${expansion}`);
    if (q) filters.push(Prisma.sql`p."name" ILIKE ${`%${q}%`}`);
    if (minQuality != null) filters.push(Prisma.sql`s."sampleQuality" >= ${minQuality}`);
    const whereSql = Prisma.join(filters, " AND ");

    const [totalRow, results] = await Promise.all([
      prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::bigint AS c
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
        WHERE ${whereSql}
      `,
      prisma.$queryRaw<SignalRow[]>`
        SELECT s."idProduct", s."snapshotDate", s."lScore", s."mScore", s."delta7", s."delta30",
               s."movementClass", s."recommendation", s."headline", s."reasoningLines",
               s."sampleQuality",
               p."name", p."idCategory", p."categoryName", p."idExpansion",
               pr."trend", pr."low", pr."avg"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
        WHERE ${whereSql}
        ORDER BY ${sortMap[sort]} ${orderSql}
        LIMIT ${limit} OFFSET ${offset}
      `,
    ]);

    const total = Number(totalRow[0]?.c ?? 0n);
    res.json({
      results: results.map(serializeSignalRow),
      total,
      snapshotDate: latest.toISOString().slice(0, 10),
      offset,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

interface SignalRow {
  idProduct: number;
  snapshotDate: Date;
  lScore: number | null;
  mScore: number | null;
  delta7: number | null;
  delta30: number | null;
  movementClass: string | null;
  recommendation: string;
  headline: string;
  reasoningLines: string[];
  sampleQuality: number;
  name: string;
  idCategory: number;
  categoryName: string;
  idExpansion: number;
  trend: number | null;
  low: number | null;
  avg: number | null;
}

function serializeSignalRow(row: SignalRow) {
  return {
    idProduct: row.idProduct,
    snapshotDate: row.snapshotDate.toISOString().slice(0, 10),
    lScore: row.lScore,
    mScore: row.mScore,
    delta7: row.delta7,
    delta30: row.delta30,
    movementClass: row.movementClass,
    recommendation: row.recommendation,
    headline: row.headline,
    reasoningLines: row.reasoningLines,
    sampleQuality: row.sampleQuality,
    product: {
      idProduct: row.idProduct,
      name: row.name,
      idCategory: row.idCategory,
      categoryName: row.categoryName,
      idExpansion: row.idExpansion,
    },
    price: {
      trend: row.trend,
      low: row.low,
      avg: row.avg,
    },
  };
}

// ----------------------------------------------------------------------------
// Movers — vorsortierte Listen für den Movers-Screen (cm.md §7.3)
// ----------------------------------------------------------------------------
const MoversQuery = z.object({
  tab: z.enum(["risers", "fallers", "deals", "volatile"]).default("risers"),
  category: z.coerce.number().int().optional(),
  expansion: z.coerce.number().int().optional(),
  minQuality: z.coerce.number().min(0).max(1).default(0.5),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

cardmarketRouter.get("/cardmarket/movers", async (req, res, next) => {
  try {
    const parsed = MoversQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query", issues: parsed.error.issues });
      return;
    }
    const { tab, category, expansion, minQuality, limit, offset } = parsed.data;
    const latest = await getLatestSignalDate();
    if (!latest) {
      res.json({ results: [], total: 0, snapshotDate: null, offset, limit, tab });
      return;
    }

    const baseFilters: Prisma.Sql[] = [
      Prisma.sql`s."snapshotDate" = ${latest}::date`,
      Prisma.sql`s."sampleQuality" >= ${minQuality}`,
      NOT_BLACKLISTED,
    ];
    if (category) baseFilters.push(Prisma.sql`p."idCategory" = ${category}`);
    if (expansion) baseFilters.push(Prisma.sql`p."idExpansion" = ${expansion}`);

    let tabFilter: Prisma.Sql;
    let orderBy: Prisma.Sql;
    switch (tab) {
      case "risers":
        tabFilter = Prisma.sql`s."delta7" IS NOT NULL`;
        orderBy = Prisma.sql`s."delta7" DESC NULLS LAST`;
        break;
      case "fallers":
        tabFilter = Prisma.sql`s."delta7" IS NOT NULL`;
        orderBy = Prisma.sql`s."delta7" ASC NULLS LAST`;
        break;
      case "deals":
        // M zwischen OPPORTUNITY_MIN(0.15) und SUSPICIOUS(0.60) — echte Gelegenheiten ohne Outlier.
        tabFilter = Prisma.sql`s."mScore" IS NOT NULL AND s."mScore" > 0.15 AND s."mScore" <= 0.60`;
        orderBy = Prisma.sql`s."mScore" DESC NULLS LAST`;
        break;
      case "volatile":
        // Volatil = große absolute Bewegung. ABS(Δ7) als Treiber, mit Tie-Break ABS(Δ30).
        tabFilter = Prisma.sql`s."delta7" IS NOT NULL`;
        orderBy = Prisma.sql`ABS(s."delta7") DESC, ABS(COALESCE(s."delta30", 0)) DESC`;
        break;
    }
    const allFilters = Prisma.join([...baseFilters, tabFilter], " AND ");

    const [totalRow, results] = await Promise.all([
      prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::bigint AS c
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        WHERE ${allFilters}
      `,
      prisma.$queryRaw<SignalRow[]>`
        SELECT s."idProduct", s."snapshotDate", s."lScore", s."mScore", s."delta7", s."delta30",
               s."movementClass", s."recommendation", s."headline", s."reasoningLines",
               s."sampleQuality",
               p."name", p."idCategory", p."categoryName", p."idExpansion",
               pr."trend", pr."low", pr."avg"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
        WHERE ${allFilters}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    ]);

    res.json({
      results: results.map(serializeSignalRow),
      total: Number(totalRow[0]?.c ?? 0n),
      snapshotDate: latest.toISOString().slice(0, 10),
      offset,
      limit,
      tab,
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// Produkt-Detail: Signal + Snapshot-Historie
// ----------------------------------------------------------------------------
cardmarketRouter.get("/cardmarket/products/:idProduct/signal", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    const [product, signal, expansion, blacklistEntry] = await Promise.all([
      prisma.cardmarketProduct.findUnique({
        where: { idProduct: id },
        include: { price: true },
      }),
      prisma.cardmarketSignal.findFirst({
        where: { idProduct: id },
        orderBy: { snapshotDate: "desc" },
      }),
      // Set-Kontext aus MV
      prisma.$queryRaw<
        {
          idExpansion: number;
          productCount: number;
          medianL: number | null;
          medianDelta7: number | null;
          volatilityDelta7: number | null;
          name: string | null;
          language: string | null;
        }[]
      >`
        SELECT
          mv."idExpansion",
          mv."productCount",
          mv."medianL",
          mv."medianDelta7",
          mv."volatilityDelta7",
          e."name",
          e."language"
        FROM "CardmarketSetSignalDaily" mv
        LEFT JOIN "CardmarketExpansion" e ON e."idExpansion" = mv."idExpansion"
        WHERE mv."idExpansion" = (
          SELECT "idExpansion" FROM "CardmarketProduct" WHERE "idProduct" = ${id}
        )
        ORDER BY mv."snapshotDate" DESC
        LIMIT 1
      `,
      prisma.cardmarketBlacklistItem.findUnique({ where: { idProduct: id } }),
    ]);

    if (!product) {
      res.status(404).json({ error: "not found" });
      return;
    }

    res.json({
      product,
      signal: signal
        ? {
            ...signal,
            snapshotDate: signal.snapshotDate.toISOString().slice(0, 10),
          }
        : null,
      setContext: expansion[0] ?? null,
      blacklisted: blacklistEntry != null,
    });
  } catch (err) {
    next(err);
  }
});

const HistoryQuery = z.object({
  range: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
});

cardmarketRouter.get("/cardmarket/products/:idProduct/history", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    const parsed = HistoryQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query", issues: parsed.error.issues });
      return;
    }
    const { range } = parsed.data;

    let dateFilter: Prisma.Sql;
    if (range === "all") {
      dateFilter = Prisma.sql`TRUE`;
    } else {
      const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
      dateFilter = Prisma.sql`"snapshotDate" >= CURRENT_DATE - (${days}::int * INTERVAL '1 day')`;
    }

    const rows = await prisma.$queryRaw<
      {
        snapshotDate: Date;
        low: number | null;
        avg: number | null;
        trend: number | null;
      }[]
    >`
      SELECT "snapshotDate", "low", "avg", "trend"
      FROM "CardmarketPriceSnapshot"
      WHERE "idProduct" = ${id} AND ${dateFilter}
      ORDER BY "snapshotDate" ASC
    `;

    res.json({
      range,
      points: rows.map((r) => ({
        date: r.snapshotDate.toISOString().slice(0, 10),
        low: r.low,
        avg: r.avg,
        trend: r.trend,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// Sets — Übersicht (Phase 4)
// ----------------------------------------------------------------------------

const SetsListQuery = z.object({
  sort: z.enum(["hottest", "coldest", "volatile", "newest", "name"]).default("hottest"),
  language: z.string().max(8).optional(),
  minProducts: z.coerce.number().int().min(0).default(1),
});

interface SetSummaryRow {
  idExpansion: number;
  name: string;
  language: string;
  releaseDate: Date | null;
  productCount: number | null;
  medianL: number | null;
  medianDelta7: number | null;
  volatilityDelta7: number | null;
  greenCount: number | null;
  amberCount: number | null;
  redCount: number | null;
  neutralCount: number | null;
}

function serializeSetSummary(row: SetSummaryRow) {
  return {
    idExpansion: row.idExpansion,
    name: row.name,
    language: row.language,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString().slice(0, 10) : null,
    productCount: row.productCount ?? 0,
    medianL: row.medianL,
    medianDelta7: row.medianDelta7,
    volatilityDelta7: row.volatilityDelta7,
    ampelDistribution: {
      GREEN: row.greenCount ?? 0,
      AMBER: row.amberCount ?? 0,
      RED: row.redCount ?? 0,
      NEUTRAL: row.neutralCount ?? 0,
    },
  };
}

cardmarketRouter.get("/cardmarket/sets", async (req, res, next) => {
  try {
    const parsed = SetsListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query", issues: parsed.error.issues });
      return;
    }
    const { sort, language, minProducts } = parsed.data;

    const orderBy = (() => {
      switch (sort) {
        case "hottest":   return Prisma.sql`mv."medianDelta7" DESC NULLS LAST`;
        case "coldest":   return Prisma.sql`mv."medianDelta7" ASC NULLS LAST`;
        case "volatile":  return Prisma.sql`mv."volatilityDelta7" DESC NULLS LAST`;
        case "newest":    return Prisma.sql`e."releaseDate" DESC NULLS LAST`;
        case "name":      return Prisma.sql`e."name" ASC`;
      }
    })();

    const filters: Prisma.Sql[] = [Prisma.sql`COALESCE(mv."productCount", 0) >= ${minProducts}`];
    if (language) filters.push(Prisma.sql`e."language" = ${language}`);
    const whereSql = Prisma.join(filters, " AND ");

    const rows = await prisma.$queryRaw<SetSummaryRow[]>`
      SELECT
        e."idExpansion",
        e."name",
        e."language",
        e."releaseDate",
        mv."productCount",
        mv."medianL",
        mv."medianDelta7",
        mv."volatilityDelta7",
        dist."greenCount",
        dist."amberCount",
        dist."redCount",
        dist."neutralCount"
      FROM "CardmarketExpansion" e
      LEFT JOIN LATERAL (
        SELECT "productCount", "medianL", "medianDelta7", "volatilityDelta7"
        FROM "CardmarketSetSignalDaily"
        WHERE "idExpansion" = e."idExpansion"
        ORDER BY "snapshotDate" DESC
        LIMIT 1
      ) mv ON true
      LEFT JOIN LATERAL (
        SELECT
          SUM(CASE WHEN s."recommendation" = 'GREEN'   THEN 1 ELSE 0 END)::int AS "greenCount",
          SUM(CASE WHEN s."recommendation" = 'AMBER'   THEN 1 ELSE 0 END)::int AS "amberCount",
          SUM(CASE WHEN s."recommendation" = 'RED'     THEN 1 ELSE 0 END)::int AS "redCount",
          SUM(CASE WHEN s."recommendation" = 'NEUTRAL' THEN 1 ELSE 0 END)::int AS "neutralCount"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        WHERE p."idExpansion" = e."idExpansion"
          AND s."snapshotDate" = (SELECT MAX("snapshotDate") FROM "CardmarketSignal")
      ) dist ON true
      WHERE ${whereSql}
      ORDER BY ${orderBy}
    `;

    res.json({ results: rows.map(serializeSetSummary), total: rows.length });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// Set-Signal — Detail mit Ampel-Distribution
// ----------------------------------------------------------------------------

cardmarketRouter.get("/cardmarket/sets/:idExpansion/signal", async (req, res, next) => {
  try {
    const id = Number(req.params.idExpansion);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idExpansion must be an integer" });
      return;
    }

    const [setRow, products, dist] = await Promise.all([
      prisma.$queryRaw<
        {
          idExpansion: number;
          productCount: number | null;
          medianL: number | null;
          medianDelta7: number | null;
          volatilityDelta7: number | null;
          name: string | null;
          language: string | null;
          releaseDate: Date | null;
        }[]
      >`
        SELECT
          e."idExpansion",
          e."name",
          e."language",
          e."releaseDate",
          mv."productCount",
          mv."medianL",
          mv."medianDelta7",
          mv."volatilityDelta7"
        FROM "CardmarketExpansion" e
        LEFT JOIN LATERAL (
          SELECT "productCount", "medianL", "medianDelta7", "volatilityDelta7"
          FROM "CardmarketSetSignalDaily"
          WHERE "idExpansion" = e."idExpansion"
          ORDER BY "snapshotDate" DESC
          LIMIT 1
        ) mv ON true
        WHERE e."idExpansion" = ${id}
        LIMIT 1
      `,
      prisma.$queryRaw<SignalRow[]>`
        SELECT s."idProduct", s."snapshotDate", s."lScore", s."mScore", s."delta7", s."delta30",
               s."movementClass", s."recommendation", s."headline", s."reasoningLines",
               s."sampleQuality",
               p."name", p."idCategory", p."categoryName", p."idExpansion",
               pr."trend", pr."low", pr."avg"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
        WHERE p."idExpansion" = ${id}
          AND s."snapshotDate" = (SELECT MAX("snapshotDate") FROM "CardmarketSignal")
          AND ${NOT_BLACKLISTED}
        ORDER BY s."delta7" DESC NULLS LAST
      `,
      prisma.$queryRaw<{ greenCount: number; amberCount: number; redCount: number; neutralCount: number }[]>`
        SELECT
          SUM(CASE WHEN s."recommendation" = 'GREEN'   THEN 1 ELSE 0 END)::int AS "greenCount",
          SUM(CASE WHEN s."recommendation" = 'AMBER'   THEN 1 ELSE 0 END)::int AS "amberCount",
          SUM(CASE WHEN s."recommendation" = 'RED'     THEN 1 ELSE 0 END)::int AS "redCount",
          SUM(CASE WHEN s."recommendation" = 'NEUTRAL' THEN 1 ELSE 0 END)::int AS "neutralCount"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        WHERE p."idExpansion" = ${id}
          AND s."snapshotDate" = (SELECT MAX("snapshotDate") FROM "CardmarketSignal")
      `,
    ]);

    const setData = setRow[0]
      ? {
          idExpansion: setRow[0].idExpansion,
          name: setRow[0].name,
          language: setRow[0].language,
          releaseDate: setRow[0].releaseDate
            ? setRow[0].releaseDate.toISOString().slice(0, 10)
            : null,
          productCount: setRow[0].productCount ?? 0,
          medianL: setRow[0].medianL,
          medianDelta7: setRow[0].medianDelta7,
          volatilityDelta7: setRow[0].volatilityDelta7,
        }
      : null;

    const distRow = dist[0];
    res.json({
      set: setData,
      products: products.map(serializeSignalRow),
      ampelDistribution: {
        GREEN: distRow?.greenCount ?? 0,
        AMBER: distRow?.amberCount ?? 0,
        RED: distRow?.redCount ?? 0,
        NEUTRAL: distRow?.neutralCount ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// Set-History — Median-trend über Zeit für Aggregat-Chart
// ----------------------------------------------------------------------------
cardmarketRouter.get("/cardmarket/sets/:idExpansion/history", async (req, res, next) => {
  try {
    const id = Number(req.params.idExpansion);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idExpansion must be an integer" });
      return;
    }
    const range = (() => {
      const r = String(req.query.range ?? "30d");
      return r === "7d" || r === "30d" || r === "90d" || r === "all" ? r : "30d";
    })();
    const dateFilter =
      range === "all"
        ? Prisma.sql`TRUE`
        : Prisma.sql`pr."snapshotDate" >= CURRENT_DATE - (${range === "7d" ? 7 : range === "30d" ? 30 : 90}::int * INTERVAL '1 day')`;

    const rows = await prisma.$queryRaw<{ snapshotDate: Date; medianTrend: number | null }[]>`
      SELECT
        pr."snapshotDate",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY pr."trend") AS "medianTrend"
      FROM "CardmarketPriceSnapshot" pr
      JOIN "CardmarketProduct" p ON p."idProduct" = pr."idProduct"
      WHERE p."idExpansion" = ${id}
        AND pr."trend" IS NOT NULL
        AND ${dateFilter}
      GROUP BY pr."snapshotDate"
      ORDER BY pr."snapshotDate" ASC
    `;

    res.json({
      range,
      points: rows.map((r) => ({
        date: r.snapshotDate.toISOString().slice(0, 10),
        medianTrend: r.medianTrend == null ? null : Number(r.medianTrend),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// Dashboard — Marktstimmung + Tageshighlights (cm.md §7.2)
// ----------------------------------------------------------------------------
cardmarketRouter.get("/cardmarket/dashboard", async (_req, res, next) => {
  try {
    const latest = await getLatestSignalDate();
    if (!latest) {
      res.json({
        snapshotDate: null,
        breadthIndex: null,
        breadthIndex7dAgo: null,
        breadthIndexSparkline: [],
        highlights: { topRiser: null, topFaller: null, biggestDeal: null },
        topGreen: [],
        lastSyncLog: null,
      });
      return;
    }

    // Breitenindex = % aller Produkte mit Δ7 > 0.
    const breadthRow = await prisma.$queryRaw<{ pct: number | null }[]>`
      SELECT
        ROUND(100.0 * SUM(CASE WHEN "delta7" > 0 THEN 1 ELSE 0 END)::numeric
              / NULLIF(COUNT(*) FILTER (WHERE "delta7" IS NOT NULL), 0), 1) AS pct
      FROM "CardmarketSignal"
      WHERE "snapshotDate" = ${latest}::date
    `;
    const breadthIndex = breadthRow[0]?.pct == null ? null : Number(breadthRow[0].pct);

    // 7d-Vergleich + 30-Tage-Sparkline.
    const sparkline = await prisma.$queryRaw<{ snapshotDate: Date; pct: number | null }[]>`
      SELECT
        "snapshotDate",
        ROUND(100.0 * SUM(CASE WHEN "delta7" > 0 THEN 1 ELSE 0 END)::numeric
              / NULLIF(COUNT(*) FILTER (WHERE "delta7" IS NOT NULL), 0), 1) AS pct
      FROM "CardmarketSignal"
      WHERE "snapshotDate" >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY "snapshotDate"
      ORDER BY "snapshotDate" ASC
    `;
    const sparkPoints = sparkline.map((r) => ({
      date: r.snapshotDate.toISOString().slice(0, 10),
      breadthIndex: r.pct == null ? null : Number(r.pct),
    }));
    const sevenDayRow = sparkPoints.find(
      (p) =>
        p.date ===
        new Date(latest.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    );
    const breadthIndex7dAgo = sevenDayRow?.breadthIndex ?? null;

    // Highlights: Top-Riser, Top-Faller, größter Listing-Deal — alle mit Quality >= 0.5
    const [topRiserRows, topFallerRows, biggestDealRows] = await Promise.all([
      prisma.$queryRaw<SignalRow[]>`
        SELECT s."idProduct", s."snapshotDate", s."lScore", s."mScore", s."delta7", s."delta30",
               s."movementClass", s."recommendation", s."headline", s."reasoningLines",
               s."sampleQuality",
               p."name", p."idCategory", p."categoryName", p."idExpansion",
               pr."trend", pr."low", pr."avg"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
        WHERE s."snapshotDate" = ${latest}::date
          AND s."sampleQuality" >= 0.5
          AND s."delta7" IS NOT NULL
          AND ${NOT_BLACKLISTED}
        ORDER BY s."delta7" DESC
        LIMIT 1
      `,
      prisma.$queryRaw<SignalRow[]>`
        SELECT s."idProduct", s."snapshotDate", s."lScore", s."mScore", s."delta7", s."delta30",
               s."movementClass", s."recommendation", s."headline", s."reasoningLines",
               s."sampleQuality",
               p."name", p."idCategory", p."categoryName", p."idExpansion",
               pr."trend", pr."low", pr."avg"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
        WHERE s."snapshotDate" = ${latest}::date
          AND s."sampleQuality" >= 0.5
          AND s."delta7" IS NOT NULL
          AND ${NOT_BLACKLISTED}
        ORDER BY s."delta7" ASC
        LIMIT 1
      `,
      prisma.$queryRaw<SignalRow[]>`
        SELECT s."idProduct", s."snapshotDate", s."lScore", s."mScore", s."delta7", s."delta30",
               s."movementClass", s."recommendation", s."headline", s."reasoningLines",
               s."sampleQuality",
               p."name", p."idCategory", p."categoryName", p."idExpansion",
               pr."trend", pr."low", pr."avg"
        FROM "CardmarketSignal" s
        JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
        LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
        WHERE s."snapshotDate" = ${latest}::date
          AND s."sampleQuality" >= 0.5
          AND s."mScore" IS NOT NULL
          AND s."mScore" > 0.15
          AND s."mScore" <= 0.60
          AND ${NOT_BLACKLISTED}
        ORDER BY s."mScore" DESC
        LIMIT 1
      `,
    ]);

    // Top-5 GREEN-Signale für Watchlist-Stub (Phase 1+2 ohne Watchlist).
    const topGreen = await prisma.$queryRaw<SignalRow[]>`
      SELECT s."idProduct", s."snapshotDate", s."lScore", s."mScore", s."delta7", s."delta30",
             s."movementClass", s."recommendation", s."headline", s."reasoningLines",
             s."sampleQuality",
             p."name", p."idCategory", p."categoryName", p."idExpansion",
             pr."trend", pr."low", pr."avg"
      FROM "CardmarketSignal" s
      JOIN "CardmarketProduct" p ON p."idProduct" = s."idProduct"
      LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = s."idProduct"
      WHERE s."snapshotDate" = ${latest}::date
        AND s."recommendation" = 'GREEN'
        AND s."sampleQuality" >= 0.5
        AND ${NOT_BLACKLISTED}
      ORDER BY s."sampleQuality" DESC, COALESCE(s."mScore", 0) DESC
      LIMIT 5
    `;

    const lastLog = await prisma.cardmarketSyncLog.findFirst({
      orderBy: { startedAt: "desc" },
    });

    res.json({
      snapshotDate: latest.toISOString().slice(0, 10),
      breadthIndex,
      breadthIndex7dAgo,
      breadthIndexSparkline: sparkPoints,
      highlights: {
        topRiser: topRiserRows[0] ? serializeSignalRow(topRiserRows[0]) : null,
        topFaller: topFallerRows[0] ? serializeSignalRow(topFallerRows[0]) : null,
        biggestDeal: biggestDealRows[0] ? serializeSignalRow(biggestDealRows[0]) : null,
      },
      topGreen: topGreen.map(serializeSignalRow),
      lastSyncLog: lastLog ? serializeSyncLog(lastLog) : null,
    });
  } catch (err) {
    next(err);
  }
});

function serializeSyncLog(log: {
  id: bigint;
  startedAt: Date;
  finishedAt: Date | null;
  productsCount: number | null;
  snapshotsCount: number | null;
  signalsCount: number | null;
  expansionsCount: number | null;
  watchlistAlertsCount: number | null;
  status: string;
  errorMsg: string | null;
  durationMs: number | null;
}) {
  return {
    id: String(log.id),
    startedAt: log.startedAt.toISOString(),
    finishedAt: log.finishedAt ? log.finishedAt.toISOString() : null,
    productsCount: log.productsCount,
    snapshotsCount: log.snapshotsCount,
    signalsCount: log.signalsCount,
    expansionsCount: log.expansionsCount,
    watchlistAlertsCount: log.watchlistAlertsCount,
    status: log.status,
    errorMsg: log.errorMsg,
    durationMs: log.durationMs,
  };
}

// ----------------------------------------------------------------------------
// Admin-Endpoints
// ----------------------------------------------------------------------------
const SyncBodySchema = z
  .object({
    // skipDownload=true nutzt die letzten lokalen JSON-Dumps statt CM neu zu
    // ziehen. Praktisch wenn CM gerade SSL-Probleme hat oder du nach dem
    // Aufsetzen erstmal mit cached Daten testen willst. Achtung: Snapshots
    // werden trotzdem fuer heute angelegt — wenn die Files alt sind, sind
    // die Snapshots eben aus dieser alten Quelle.
    skipDownload: z.boolean().optional(),
    // signalsOnly=true ueberspringt Step 1-4 komplett; nur Step 5 (Signale)
    // laeuft. Sinnvoll nach Schwellwert-Aenderung. Watchlist-Alerts werden
    // dann bewusst NICHT gefeuert.
    signalsOnly: z.boolean().optional(),
  })
  .optional();

cardmarketRouter.post("/admin/cardmarket/sync", async (req, res, next) => {
  try {
    const parsed = SyncBodySchema.safeParse(req.body);
    const opts = parsed.success ? (parsed.data ?? {}) : {};
    const jobId = await triggerCardmarketSyncNow(opts);
    logger.info({ jobId, opts }, "cardmarket sync triggered via api");
    res.json({ ok: true, jobId });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.post("/admin/cardmarket/recompute-signals", async (_req, res, next) => {
  try {
    const jobId = await triggerCardmarketSyncNow({ signalsOnly: true });
    logger.info({ jobId }, "cardmarket signals recompute triggered via api");
    res.json({ ok: true, jobId });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.post("/admin/cardmarket/scrape-expansions", async (_req, res, next) => {
  try {
    // Synchron in der Request — Scrape ist 1 HTTP-Request + Upsert, dauert ~5s.
    const result = await runExpansionsScrape();
    logger.info(result, "expansions scrape triggered via api");
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.get("/admin/cardmarket/sync-log", async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
    const logs = await prisma.cardmarketSyncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    res.json(logs.map(serializeSyncLog));
  } catch (err) {
    next(err);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

cardmarketRouter.post(
  "/admin/cardmarket/upload",
  upload.fields([
    { name: "products", maxCount: 1 },
    { name: "prices", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const files = req.files as { products?: Express.Multer.File[]; prices?: Express.Multer.File[] } | undefined;
      const productsFile = files?.products?.[0];
      const pricesFile = files?.prices?.[0];

      if (!productsFile && !pricesFile) {
        res.status(400).json({ error: "no files uploaded — expected 'products' and/or 'prices' fields" });
        return;
      }

      await ensureCardmarketDir();
      if (productsFile) await writeFile(PRODUCTS_PATH, productsFile.buffer);
      if (pricesFile) await writeFile(PRICE_GUIDE_PATH, pricesFile.buffer);

      const jobId = await triggerCardmarketSyncNow({ skipDownload: true });
      logger.info(
        { jobId, productsBytes: productsFile?.size ?? 0, pricesBytes: pricesFile?.size ?? 0 },
        "cardmarket files uploaded — sync triggered",
      );
      res.json({
        ok: true,
        jobId,
        productsReceived: !!productsFile,
        pricesReceived: !!pricesFile,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================================
// Phase 3 — Watchlist + Alerts (cm.md §5 + §11)
// ============================================================================

const WatchlistUpsertSchema = z.object({
  idProduct: z.coerce.number().int(),
  note: z.string().trim().max(500).optional().nullable(),
  alertBelowTrend: z.coerce.number().positive().optional().nullable(),
  alertAboveTrend: z.coerce.number().positive().optional().nullable(),
  alertOnSignalFlip: z.boolean().optional(),
});

const WatchlistPatchSchema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
  alertBelowTrend: z.coerce.number().positive().optional().nullable(),
  alertAboveTrend: z.coerce.number().positive().optional().nullable(),
  alertOnSignalFlip: z.boolean().optional(),
});

interface WatchlistRow {
  id: bigint;
  idProduct: number;
  note: string | null;
  alertBelowTrend: number | null;
  alertAboveTrend: number | null;
  alertOnSignalFlip: boolean;
  addedAt: Date;
  updatedAt: Date;
  lastAlertSentAt: Date | null;
  lastNotifiedRecommendation: string | null;
  productName: string;
  categoryName: string;
  idCategory: number;
  idExpansion: number;
  trend: number | null;
  low: number | null;
  avg: number | null;
  todayRecommendation: string | null;
  todayHeadline: string | null;
  todayDelta7: number | null;
  todayLScore: number | null;
  todayMScore: number | null;
}

function serializeWatchlistRow(row: WatchlistRow) {
  return {
    id: String(row.id),
    idProduct: row.idProduct,
    note: row.note,
    alertBelowTrend: row.alertBelowTrend,
    alertAboveTrend: row.alertAboveTrend,
    alertOnSignalFlip: row.alertOnSignalFlip,
    addedAt: row.addedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastAlertSentAt: row.lastAlertSentAt ? row.lastAlertSentAt.toISOString() : null,
    lastNotifiedRecommendation: row.lastNotifiedRecommendation,
    product: {
      idProduct: row.idProduct,
      name: row.productName,
      idCategory: row.idCategory,
      categoryName: row.categoryName,
      idExpansion: row.idExpansion,
    },
    price: {
      trend: row.trend,
      low: row.low,
      avg: row.avg,
    },
    signal: row.todayRecommendation
      ? {
          recommendation: row.todayRecommendation,
          headline: row.todayHeadline,
          delta7: row.todayDelta7,
          lScore: row.todayLScore,
          mScore: row.todayMScore,
        }
      : null,
  };
}

const WATCHLIST_LIST_QUERY = Prisma.sql`
  SELECT
    w."id",
    w."idProduct",
    w."note",
    w."alertBelowTrend",
    w."alertAboveTrend",
    w."alertOnSignalFlip",
    w."addedAt",
    w."updatedAt",
    w."lastAlertSentAt",
    w."lastNotifiedRecommendation",
    p."name"         AS "productName",
    p."categoryName",
    p."idCategory",
    p."idExpansion",
    pr."trend",
    pr."low",
    pr."avg",
    s."recommendation" AS "todayRecommendation",
    s."headline"       AS "todayHeadline",
    s."delta7"         AS "todayDelta7",
    s."lScore"         AS "todayLScore",
    s."mScore"         AS "todayMScore"
  FROM "CardmarketWatchlistItem" w
  JOIN "CardmarketProduct" p ON p."idProduct" = w."idProduct"
  LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = w."idProduct"
  LEFT JOIN "CardmarketSignal" s ON s."idProduct" = w."idProduct"
                                AND s."snapshotDate" = (
                                  SELECT MAX("snapshotDate") FROM "CardmarketSignal"
                                )
`;

cardmarketRouter.get("/cardmarket/watchlist", async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRaw<WatchlistRow[]>`
      ${WATCHLIST_LIST_QUERY}
      ORDER BY w."addedAt" DESC
    `;
    res.json({ results: rows.map(serializeWatchlistRow), total: rows.length });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.post("/cardmarket/watchlist", async (req, res, next) => {
  try {
    const parsed = WatchlistUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const { idProduct, note, alertBelowTrend, alertAboveTrend, alertOnSignalFlip } = parsed.data;

    // FK-Check: Produkt muss existieren.
    const product = await prisma.cardmarketProduct.findUnique({ where: { idProduct } });
    if (!product) {
      res.status(404).json({ error: "product not found" });
      return;
    }

    // Snapshot der HEUTIGEN Empfehlung mit anlegen, sonst feuert beim
    // nächsten Sync der erste Sync-Run sofort einen "Flip"-Alert weil
    // lastNotifiedRecommendation null war.
    const todaySignal = await prisma.cardmarketSignal.findFirst({
      where: { idProduct },
      orderBy: { snapshotDate: "desc" },
      select: { recommendation: true },
    });

    const item = await prisma.cardmarketWatchlistItem.upsert({
      where: { idProduct },
      create: {
        idProduct,
        note: note ?? null,
        alertBelowTrend: alertBelowTrend ?? null,
        alertAboveTrend: alertAboveTrend ?? null,
        alertOnSignalFlip: alertOnSignalFlip ?? true,
        lastNotifiedRecommendation: todaySignal?.recommendation ?? null,
      },
      update: {
        note: note ?? null,
        alertBelowTrend: alertBelowTrend ?? null,
        alertAboveTrend: alertAboveTrend ?? null,
        ...(alertOnSignalFlip !== undefined ? { alertOnSignalFlip } : {}),
      },
    });

    res.json({ id: String(item.id), idProduct: item.idProduct });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.patch("/cardmarket/watchlist/:idProduct", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    const parsed = WatchlistPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const existing = await prisma.cardmarketWatchlistItem.findUnique({
      where: { idProduct: id },
    });
    if (!existing) {
      res.status(404).json({ error: "not on watchlist" });
      return;
    }
    const { note, alertBelowTrend, alertAboveTrend, alertOnSignalFlip } = parsed.data;
    const updated = await prisma.cardmarketWatchlistItem.update({
      where: { idProduct: id },
      data: {
        ...(note !== undefined ? { note: note ?? null } : {}),
        ...(alertBelowTrend !== undefined ? { alertBelowTrend: alertBelowTrend ?? null } : {}),
        ...(alertAboveTrend !== undefined ? { alertAboveTrend: alertAboveTrend ?? null } : {}),
        ...(alertOnSignalFlip !== undefined ? { alertOnSignalFlip } : {}),
      },
    });
    res.json({ id: String(updated.id), idProduct: updated.idProduct });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.delete("/cardmarket/watchlist/:idProduct", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    try {
      await prisma.cardmarketWatchlistItem.delete({ where: { idProduct: id } });
    } catch (err) {
      // P2025: record to delete not found — idempotent: 204 zurückgeben.
      if ((err as { code?: string }).code === "P2025") {
        res.status(204).end();
        return;
      }
      throw err;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.get("/cardmarket/products/:idProduct/watchlist", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    const item = await prisma.cardmarketWatchlistItem.findUnique({
      where: { idProduct: id },
    });
    if (!item) {
      res.json(null);
      return;
    }
    res.json({
      id: String(item.id),
      idProduct: item.idProduct,
      note: item.note,
      alertBelowTrend: item.alertBelowTrend,
      alertAboveTrend: item.alertAboveTrend,
      alertOnSignalFlip: item.alertOnSignalFlip,
      addedAt: item.addedAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      lastAlertSentAt: item.lastAlertSentAt ? item.lastAlertSentAt.toISOString() : null,
      lastNotifiedRecommendation: item.lastNotifiedRecommendation,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// Blacklist — ausgeblendete Artikel (verschwinden aus allen Artikel-Listen)
// ============================================================================

interface BlacklistRow {
  id: bigint;
  idProduct: number;
  addedAt: Date;
  productName: string;
  categoryName: string;
  idCategory: number;
  idExpansion: number;
  trend: number | null;
  low: number | null;
  avg: number | null;
  todayRecommendation: string | null;
  todayHeadline: string | null;
  todayDelta7: number | null;
  todayLScore: number | null;
  todayMScore: number | null;
}

function serializeBlacklistRow(row: BlacklistRow) {
  return {
    id: String(row.id),
    idProduct: row.idProduct,
    addedAt: row.addedAt.toISOString(),
    product: {
      idProduct: row.idProduct,
      name: row.productName,
      idCategory: row.idCategory,
      categoryName: row.categoryName,
      idExpansion: row.idExpansion,
    },
    price: { trend: row.trend, low: row.low, avg: row.avg },
    signal: row.todayRecommendation
      ? {
          recommendation: row.todayRecommendation,
          headline: row.todayHeadline,
          delta7: row.todayDelta7,
          lScore: row.todayLScore,
          mScore: row.todayMScore,
        }
      : null,
  };
}

cardmarketRouter.get("/cardmarket/blacklist", async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRaw<BlacklistRow[]>`
      SELECT
        b."id",
        b."idProduct",
        b."addedAt",
        p."name"         AS "productName",
        p."categoryName",
        p."idCategory",
        p."idExpansion",
        pr."trend",
        pr."low",
        pr."avg",
        s."recommendation" AS "todayRecommendation",
        s."headline"       AS "todayHeadline",
        s."delta7"         AS "todayDelta7",
        s."lScore"         AS "todayLScore",
        s."mScore"         AS "todayMScore"
      FROM "CardmarketBlacklistItem" b
      JOIN "CardmarketProduct" p ON p."idProduct" = b."idProduct"
      LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = b."idProduct"
      LEFT JOIN "CardmarketSignal" s ON s."idProduct" = b."idProduct"
                                    AND s."snapshotDate" = (
                                      SELECT MAX("snapshotDate") FROM "CardmarketSignal"
                                    )
      ORDER BY b."addedAt" DESC
    `;
    res.json({ results: rows.map(serializeBlacklistRow), total: rows.length });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.post("/cardmarket/products/:idProduct/blacklist", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    const product = await prisma.cardmarketProduct.findUnique({ where: { idProduct: id } });
    if (!product) {
      res.status(404).json({ error: "product not found" });
      return;
    }
    const item = await prisma.cardmarketBlacklistItem.upsert({
      where: { idProduct: id },
      create: { idProduct: id },
      update: {},
    });
    res.json({ id: String(item.id), idProduct: item.idProduct });
  } catch (err) {
    next(err);
  }
});

cardmarketRouter.delete("/cardmarket/products/:idProduct/blacklist", async (req, res, next) => {
  try {
    const id = Number(req.params.idProduct);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "idProduct must be an integer" });
      return;
    }
    try {
      await prisma.cardmarketBlacklistItem.delete({ where: { idProduct: id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2025") {
        res.status(204).end();
        return;
      }
      throw err;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
