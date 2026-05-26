import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { invalidateSetsForShopCache } from "../../matcher/setMatcher.js";

export const listsRouter = Router();

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  setIds: z.array(z.string().min(1)).default([]),
});

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  setIds: z.array(z.string().min(1)).optional(),
});

const AddItemSchema = z.object({
  setId: z.string().min(1),
});

listsRouter.get("/lists", async (_req, res, next) => {
  try {
    const rows = await prisma.setList.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: { _count: { select: { items: true, shops: true } } },
    });
    res.json(
      rows.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        isSystem: l.isSystem,
        itemCount: l._count.items,
        shopCount: l._count.shops,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

listsRouter.get("/lists/:id", async (req, res, next) => {
  try {
    const list = await prisma.setList.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: { set: { select: { id: true, name: true, era: true, releaseDate: true } } },
        },
        _count: { select: { shops: true } },
      },
    });
    if (!list) {
      res.status(404).json({ error: "list not found" });
      return;
    }
    res.json({
      id: list.id,
      name: list.name,
      description: list.description,
      isSystem: list.isSystem,
      shopCount: list._count.shops,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      setIds: list.items.map((i) => i.setId),
      sets: list.items.map((i) => i.set),
    });
  } catch (err) {
    next(err);
  }
});

listsRouter.post("/lists", async (req, res, next) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const created = await prisma.setList.create({
      data: {
        name: d.name,
        description: d.description ?? null,
        items: { create: d.setIds.map((setId) => ({ setId })) },
      },
      include: { _count: { select: { items: true } } },
    });
    invalidateSetsForShopCache();
    res.status(201).json({
      id: created.id,
      name: created.name,
      description: created.description,
      isSystem: created.isSystem,
      itemCount: created._count.items,
    });
  } catch (err) {
    next(err);
  }
});

listsRouter.patch("/lists/:id", async (req, res, next) => {
  try {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const id = req.params.id;

    // If setIds is supplied, replace the list membership atomically.
    if (d.setIds !== undefined) {
      await prisma.$transaction([
        prisma.setListItem.deleteMany({ where: { setListId: id } }),
        prisma.setListItem.createMany({
          data: d.setIds.map((setId) => ({ setListId: id, setId })),
          skipDuplicates: true,
        }),
      ]);
    }

    const updated = await prisma.setList.update({
      where: { id },
      data: {
        name: d.name,
        description: d.description,
      },
      include: { _count: { select: { items: true, shops: true } } },
    });

    invalidateSetsForShopCache();
    res.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      isSystem: updated.isSystem,
      itemCount: updated._count.items,
      shopCount: updated._count.shops,
    });
  } catch (err) {
    next(err);
  }
});

listsRouter.delete("/lists/:id", async (req, res, next) => {
  try {
    const list = await prisma.setList.findUnique({ where: { id: req.params.id } });
    if (!list) {
      res.status(404).json({ error: "list not found" });
      return;
    }
    if (list.isSystem) {
      res.status(400).json({ error: "system lists cannot be deleted" });
      return;
    }
    await prisma.setList.delete({ where: { id: req.params.id } });
    invalidateSetsForShopCache();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

listsRouter.post("/lists/:id/items", async (req, res, next) => {
  try {
    const parsed = AddItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    await prisma.setListItem.upsert({
      where: { setListId_setId: { setListId: req.params.id, setId: parsed.data.setId } },
      create: { setListId: req.params.id, setId: parsed.data.setId },
      update: {},
    });
    invalidateSetsForShopCache();
    res.status(201).json({ setListId: req.params.id, setId: parsed.data.setId });
  } catch (err) {
    next(err);
  }
});

listsRouter.delete("/lists/:id/items/:setId", async (req, res, next) => {
  try {
    await prisma.setListItem.deleteMany({
      where: { setListId: req.params.id, setId: req.params.setId },
    });
    invalidateSetsForShopCache();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
