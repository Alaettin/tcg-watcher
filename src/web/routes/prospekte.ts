import { Router } from "express";
import { prisma } from "../../lib/prisma.js";

export const prospekteRouter = Router();

prospekteRouter.get("/prospekte", async (req, res, next) => {
  try {
    const retailerId = typeof req.query.retailer === "string" ? req.query.retailer : undefined;
    const onlyActive = req.query.onlyActive !== "false"; // default true
    const where: Record<string, unknown> = {};
    if (retailerId) where.retailerId = retailerId;
    if (onlyActive) where.validUntil = { gte: new Date() };

    const deals = await prisma.offlineDeal.findMany({
      where,
      orderBy: [{ validUntil: "asc" }, { firstSeenAt: "desc" }],
      include: { retailer: true },
      take: 200,
    });

    res.json(deals.map((d) => ({
      id: d.id,
      source: d.source,
      sourceDealId: d.sourceDealId,
      retailerId: d.retailerId,
      retailerName: d.retailer.displayName,
      title: d.title,
      description: d.description,
      brand: d.brand,
      imageUrl: d.imageUrl,
      category: d.category,
      priceEur: d.priceEur,
      originalPriceEur: d.originalPriceEur,
      validFrom: d.validFrom,
      validUntil: d.validUntil,
      sourceUrl: d.sourceUrl,
      postalCode: d.postalCode,
      storeName: d.storeName,
      storeAddress: d.storeAddress,
      storeCity: d.storeCity,
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
    })));
  } catch (err) {
    next(err);
  }
});

prospekteRouter.get("/prospekte/retailers", async (_req, res, next) => {
  try {
    const retailers = await prisma.offlineRetailer.findMany({
      orderBy: { displayName: "asc" },
      include: {
        _count: {
          select: {
            deals: { where: { validUntil: { gte: new Date() } } },
          },
        },
      },
    });
    res.json(
      retailers.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        logoUrl: r.logoUrl,
        activeDealsCount: r._count.deals,
      })),
    );
  } catch (err) {
    next(err);
  }
});

prospekteRouter.get("/prospekte/:id", async (req, res, next) => {
  try {
    const deal = await prisma.offlineDeal.findUnique({
      where: { id: req.params.id },
      include: { retailer: true, events: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
    if (!deal) {
      res.status(404).json({ error: "deal not found" });
      return;
    }
    res.json(deal);
  } catch (err) {
    next(err);
  }
});
