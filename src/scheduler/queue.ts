import { Queue, Worker, type JobsOptions } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { createRedisConnection } from "./redis.js";
import { runShop } from "../worker/runShop.js";
import { getCurrentIntervalSeconds, triggerCascadeBoost, currentDropWindow } from "./dropDay.js";
import { sendDailyHeartbeat } from "../notify/heartbeat.js";
import { closeBrowser } from "../adapters/playwright-browser.js";

export const QUEUE_NAME = "shop-runs";

interface ShopRunJob {
  shopId: string;
}

const HEARTBEAT_QUEUE = "heartbeat";

let sharedQueue: Queue<ShopRunJob> | null = null;

export function getQueue(): Queue<ShopRunJob> {
  if (!sharedQueue) {
    sharedQueue = new Queue<ShopRunJob>(QUEUE_NAME, { connection: createRedisConnection() });
  }
  return sharedQueue;
}

export async function pauseQueue(): Promise<void> {
  await getQueue().pause();
}

export async function resumeQueue(): Promise<void> {
  await getQueue().resume();
}

export interface QueueStatus {
  paused: boolean;
  waiting: number;
  active: number;
  delayed: number;
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const q = getQueue();
  const [paused, waiting, active, delayed] = await Promise.all([
    q.isPaused(),
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getDelayedCount(),
  ]);
  return { paused, waiting, active, delayed };
}

export async function triggerShopNow(shopId: string): Promise<string> {
  const job = await getQueue().add(
    "shop-run",
    { shopId },
    {
      jobId: `manual-${shopId}-${Date.now()}`,
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    },
  );
  return String(job.id ?? "");
}

export async function startScheduler(): Promise<{ stop: () => Promise<void> }> {
  const queue = getQueue();
  const heartbeatQueue = new Queue(HEARTBEAT_QUEUE, { connection: createRedisConnection() });

  const worker = new Worker<ShopRunJob>(
    QUEUE_NAME,
    async (job) => {
      const result = await runShop(job.data.shopId);
      if (result.boostWorthyEvents > 0) {
        triggerCascadeBoost();
        logger.info(
          { events: result.boostWorthyEvents, shopId: result.shopId },
          "cascade boost triggered (NEW_LISTING/RESTOCK)",
        );
      }
      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 3,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, shopId: job?.data.shopId, jobId: job?.id }, "shop-run job failed");
  });

  const heartbeatWorker = new Worker(
    HEARTBEAT_QUEUE,
    async (job) => {
      if (job.name === "daily") {
        await sendDailyHeartbeat();
        return;
      }
      const window = currentDropWindow();
      logger.info({ dropWindow: window?.label ?? null }, "heartbeat tick");
    },
    { connection: createRedisConnection() },
  );

  await reconcileRepeatables(queue);

  await heartbeatQueue.add(
    "tick",
    {},
    {
      repeat: { every: 30 * 60_000 },
      jobId: "heartbeat-tick",
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

  await heartbeatQueue.add(
    "daily",
    {},
    {
      repeat: { pattern: "0 9 * * *", tz: "Europe/Berlin" },
      jobId: "heartbeat-daily",
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

  const reconcileTimer = setInterval(() => {
    reconcileRepeatables(queue).catch((err) =>
      logger.error({ err }, "scheduler reconcile failed"),
    );
  }, 60_000);

  return {
    async stop() {
      clearInterval(reconcileTimer);
      await worker.close();
      await heartbeatWorker.close();
      await queue.close();
      sharedQueue = null;
      await heartbeatQueue.close();
      await closeBrowser();
    },
  };
}

async function reconcileRepeatables(queue: Queue<ShopRunJob>): Promise<void> {
  const shops = await prisma.shop.findMany({ where: { enabled: true } });
  const desired = new Map<string, { every: number }>();
  for (const shop of shops) {
    const seconds = getCurrentIntervalSeconds(shop);
    desired.set(shop.id, { every: seconds * 1000 });
  }

  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name !== "shop-run") continue;
    const shopId = job.id ?? "";
    const target = desired.get(shopId);
    const currentEvery = job.every != null ? Number(job.every) : NaN;
    if (!target || target.every !== currentEvery) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  const refreshed = await queue.getRepeatableJobs();
  const present = new Set(refreshed.filter((j) => j.name === "shop-run").map((j) => j.id));

  for (const [shopId, opts] of desired.entries()) {
    if (present.has(shopId)) continue;
    const jobOpts: JobsOptions = {
      repeat: { every: opts.every },
      jobId: shopId,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    };
    await queue.add("shop-run", { shopId }, jobOpts);
    logger.info({ shopId, everyMs: opts.every }, "shop scheduled");
  }
}
