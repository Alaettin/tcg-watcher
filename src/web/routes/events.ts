import { Router, type Response } from "express";
import { EventType, type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { eventBus } from "../eventBus.js";
import { logger } from "../../lib/logger.js";

export const eventsRouter = Router();

eventsRouter.get("/events", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const where: Prisma.EventWhereInput = {};

    if (typeof req.query.type === "string") {
      const validTypes = Object.values(EventType) as string[];
      if (validTypes.includes(req.query.type)) {
        where.type = req.query.type as EventType;
      }
    }
    const listingFilter: Prisma.ListingWhereInput = {};
    if (typeof req.query.shopId === "string" && req.query.shopId.length > 0) {
      listingFilter.shopId = req.query.shopId;
    }
    if (typeof req.query.productId === "string" && req.query.productId.length > 0) {
      listingFilter.productId = req.query.productId;
    }
    if (Object.keys(listingFilter).length > 0) {
      where.listing = listingFilter;
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        listing: {
          select: {
            shopId: true,
            productId: true,
            title: true,
            url: true,
            priceEur: true,
            status: true,
          },
        },
      },
    });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

eventsRouter.get("/stream", (req, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 30_000);

  const unsubscribe = eventBus.onDetected((event) => {
    try {
      res.write(`event: detected\ndata: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      logger.warn({ err }, "sse write failed");
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});
