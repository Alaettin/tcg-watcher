import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

export const productsRouter = Router();

const ProductSchema = z.object({
  id: z.string().min(1).max(120),
  displayName: z.string().min(1).max(200),
  category: z.string().min(1).max(60),
  expectedReleaseDate: z.string().nullable().optional(),
  uvpEur: z.number().nullable(),
  uvpToleranceEur: z.number().default(10),
  searchTerms: z.array(z.string()).min(1),
  negativeTerms: z.array(z.string()).default([]),
  ean: z.string().nullable().default(null),
  minResalePriceEur: z.number().nullable().default(null),
  active: z.boolean().optional(),
});

const ProductPatchSchema = ProductSchema.partial().omit({ id: true });

productsRouter.get("/products", async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

productsRouter.post("/products", async (req, res, next) => {
  try {
    const parsed = ProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const created = await prisma.product.create({
      data: {
        id: d.id,
        displayName: d.displayName,
        category: d.category,
        expectedReleaseDate: d.expectedReleaseDate ? new Date(d.expectedReleaseDate) : null,
        uvpEur: d.uvpEur,
        uvpToleranceEur: d.uvpToleranceEur,
        searchTerms: d.searchTerms,
        negativeTerms: d.negativeTerms,
        ean: d.ean,
        minResalePriceEur: d.minResalePriceEur,
        active: d.active ?? true,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

productsRouter.patch("/products/:id", async (req, res, next) => {
  try {
    const parsed = ProductPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const updated = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...d,
        expectedReleaseDate: d.expectedReleaseDate === undefined
          ? undefined
          : d.expectedReleaseDate
            ? new Date(d.expectedReleaseDate)
            : null,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

productsRouter.delete("/products/:id", async (req, res, next) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
