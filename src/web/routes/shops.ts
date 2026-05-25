import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { triggerShopNow } from "../../scheduler/queue.js";
import { getCurrentIntervalSeconds } from "../../scheduler/dropDay.js";

export const shopsRouter = Router();

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  pollIntervalSeconds: z.number().int().min(10).max(86400).optional(),
  dropDayIntervalSeconds: z.number().int().min(5).max(3600).optional(),
  displayName: z.string().min(1).max(120).optional(),
});

shopsRouter.get("/shops", async (_req, res, next) => {
  try {
    const shops = await prisma.shop.findMany({ orderBy: { id: "asc" } });
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const eventCounts = await prisma.event.groupBy({
      by: ["listingId"],
      _count: { _all: true },
      where: { createdAt: { gt: since } },
    });
    const listingShops = await prisma.listing.findMany({
      where: { id: { in: eventCounts.map((e) => e.listingId) } },
      select: { id: true, shopId: true },
    });
    const eventsByShop = new Map<string, number>();
    for (const ec of eventCounts) {
      const listing = listingShops.find((l) => l.id === ec.listingId);
      if (!listing) continue;
      eventsByShop.set(listing.shopId, (eventsByShop.get(listing.shopId) ?? 0) + ec._count._all);
    }
    res.json(
      shops.map((s) => {
        const effectiveS = getCurrentIntervalSeconds(s);
        return {
          ...s,
          effectiveIntervalSeconds: effectiveS,
          eventCount24h: eventsByShop.get(s.id) ?? 0,
          online: s.lastSuccessfulRun
            ? Date.now() - s.lastSuccessfulRun.getTime() < effectiveS * 1000 * 3
            : false,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

shopsRouter.patch("/shops/:id", async (req, res, next) => {
  try {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
      return;
    }
    const updated = await prisma.shop.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

shopsRouter.post("/shops/:id/trigger", async (req, res, next) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { id: req.params.id } });
    if (!shop) {
      res.status(404).json({ error: "shop not found" });
      return;
    }
    const jobId = await triggerShopNow(shop.id);
    res.json({ jobId, shopId: shop.id });
  } catch (err) {
    next(err);
  }
});
