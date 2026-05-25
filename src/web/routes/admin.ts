import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import {
  getQueueStatus,
  pauseQueue,
  resumeQueue,
  triggerShopNow,
} from "../../scheduler/queue.js";
import { sendDailyHeartbeat } from "../../notify/heartbeat.js";
import { closeBrowser } from "../../adapters/playwright-browser.js";
import { invalidateActiveSetsCache } from "../../matcher/setMatcher.js";

export const adminRouter = Router();

adminRouter.get("/scheduler/status", async (_req, res, next) => {
  try {
    const status = await getQueueStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/scheduler/pause", async (_req, res, next) => {
  try {
    await pauseQueue();
    logger.info("scheduler paused via api");
    res.json({ ok: true, ...(await getQueueStatus()) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/scheduler/resume", async (_req, res, next) => {
  try {
    await resumeQueue();
    logger.info("scheduler resumed via api");
    res.json({ ok: true, ...(await getQueueStatus()) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/reset-listings-events", async (_req, res, next) => {
  try {
    const result = await prisma.$transaction([
      prisma.event.deleteMany({}),
      prisma.listing.deleteMany({}),
    ]);
    invalidateActiveSetsCache();
    logger.warn(
      { eventsDeleted: result[0].count, listingsDeleted: result[1].count },
      "listings + events reset via api",
    );
    res.json({
      ok: true,
      eventsDeleted: result[0].count,
      listingsDeleted: result[1].count,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/send-heartbeat", async (_req, res, next) => {
  try {
    await sendDailyHeartbeat();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/restart-browser", async (_req, res, next) => {
  try {
    await closeBrowser();
    logger.info("playwright browser restarted via api");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/trigger-all", async (_req, res, next) => {
  try {
    const shops = await prisma.shop.findMany({ where: { enabled: true } });
    const jobIds: string[] = [];
    for (const shop of shops) {
      const jobId = await triggerShopNow(shop.id);
      jobIds.push(jobId);
    }
    logger.info({ count: jobIds.length }, "all shops triggered via api");
    res.json({ ok: true, triggered: jobIds.length });
  } catch (err) {
    next(err);
  }
});
