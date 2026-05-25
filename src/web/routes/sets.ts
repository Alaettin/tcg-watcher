import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { invalidateActiveSetsCache } from "../../matcher/setMatcher.js";

export const setsRouter = Router();

const SetPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  shortCode: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  language: z.string().min(2).max(8).optional(),
  era: z.string().nullable().optional(),
  searchTerms: z.array(z.string().min(1)).min(1).optional(),
  negativeTerms: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

const SetCreateSchema = SetPatchSchema.extend({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  searchTerms: z.array(z.string().min(1)).min(1),
});

const VariantSchema = z.object({
  kind: z.string().min(1).max(40),
  displayName: z.string().min(1).max(200),
  uvpEur: z.number().nullable().optional(),
  uvpToleranceEur: z.number().optional(),
  ean: z.string().nullable().optional(),
});

setsRouter.get("/sets", async (_req, res, next) => {
  try {
    const sets = await prisma.set.findMany({
      orderBy: [{ era: "asc" }, { releaseDate: "desc" }, { name: "asc" }],
      include: { variants: { orderBy: { kind: "asc" } } },
    });
    res.json(sets);
  } catch (err) {
    next(err);
  }
});

setsRouter.get("/sets/presets", async (_req, res, next) => {
  try {
    const presets = await prisma.set.findMany({
      where: { isPreset: true },
      orderBy: [{ era: "asc" }, { releaseDate: "desc" }],
      select: { id: true, name: true, shortCode: true, era: true, active: true, releaseDate: true },
    });
    res.json(presets);
  } catch (err) {
    next(err);
  }
});

setsRouter.get("/sets/:id", async (req, res, next) => {
  try {
    const set = await prisma.set.findUnique({
      where: { id: req.params.id },
      include: { variants: { orderBy: { kind: "asc" } } },
    });
    if (!set) {
      res.status(404).json({ error: "set not found" });
      return;
    }
    res.json(set);
  } catch (err) {
    next(err);
  }
});

setsRouter.post("/sets", async (req, res, next) => {
  try {
    const parsed = SetCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const created = await prisma.set.create({
      data: {
        id: d.id,
        name: d.name,
        shortCode: d.shortCode ?? null,
        description: d.description ?? null,
        releaseDate: d.releaseDate ? new Date(d.releaseDate) : null,
        language: d.language ?? "DE",
        era: d.era ?? null,
        searchTerms: d.searchTerms,
        negativeTerms: d.negativeTerms ?? [],
        active: d.active ?? true,
        isPreset: false,
      },
      include: { variants: true },
    });
    invalidateActiveSetsCache();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

setsRouter.patch("/sets/:id", async (req, res, next) => {
  try {
    const parsed = SetPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const updated = await prisma.set.update({
      where: { id: req.params.id },
      data: {
        ...d,
        releaseDate:
          d.releaseDate === undefined
            ? undefined
            : d.releaseDate
              ? new Date(d.releaseDate)
              : null,
      },
      include: { variants: { orderBy: { kind: "asc" } } },
    });
    invalidateActiveSetsCache();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

setsRouter.delete("/sets/:id", async (req, res, next) => {
  try {
    await prisma.set.delete({ where: { id: req.params.id } });
    invalidateActiveSetsCache();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

setsRouter.post("/sets/:id/variants", async (req, res, next) => {
  try {
    const parsed = VariantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const created = await prisma.variant.create({
      data: {
        setId: req.params.id,
        kind: parsed.data.kind,
        displayName: parsed.data.displayName,
        uvpEur: parsed.data.uvpEur ?? null,
        uvpToleranceEur: parsed.data.uvpToleranceEur ?? 10,
        ean: parsed.data.ean ?? null,
      },
    });
    invalidateActiveSetsCache();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

setsRouter.patch("/sets/:id/variants/:variantId", async (req, res, next) => {
  try {
    const parsed = VariantSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const updated = await prisma.variant.update({
      where: { id: req.params.variantId },
      data: parsed.data,
    });
    invalidateActiveSetsCache();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

setsRouter.delete("/sets/:id/variants/:variantId", async (req, res, next) => {
  try {
    await prisma.variant.delete({ where: { id: req.params.variantId } });
    invalidateActiveSetsCache();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
