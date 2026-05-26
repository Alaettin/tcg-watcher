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

export const cardmarketRouter = Router();

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

    const where: Prisma.CardmarketProductWhereInput = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (category) where.idCategory = category;
    if (expansion) where.idExpansion = expansion;

    let orderBy: Prisma.CardmarketProductOrderByWithRelationInput;
    if (sort === "name") {
      orderBy = { name: order };
    } else if (sort === "updatedAt") {
      orderBy = { updatedAt: order };
    } else {
      // trend/low/avg live on the related CardmarketPrice — Prisma supports
      // ordering by 1-1 relation field directly.
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
    const rows = await prisma.cardmarketProduct.groupBy({
      by: ["idExpansion"],
      _count: { idProduct: true },
      orderBy: { _count: { idProduct: "desc" } },
    });
    res.json(
      rows.map((r) => ({
        idExpansion: r.idExpansion,
        productCount: r._count.idProduct,
      })),
    );
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

cardmarketRouter.post("/admin/cardmarket/sync", async (_req, res, next) => {
  try {
    const jobId = await triggerCardmarketSyncNow();
    logger.info({ jobId }, "cardmarket sync triggered via api");
    res.json({ ok: true, jobId });
  } catch (err) {
    next(err);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — price_guide is ~14 MB, give headroom
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
