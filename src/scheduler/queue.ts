import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { createRedisConnection } from "./redis.js";
import { runShop } from "../worker/runShop.js";
import { getCurrentIntervalSeconds, triggerCascadeBoost, currentDropWindow } from "./dropDay.js";
import { sendDailyHeartbeat } from "../notify/heartbeat.js";
import { closeBrowser } from "../adapters/playwright-browser.js";
import { familyOf, type ShopFamily } from "./adapterFamily.js";

export const QUEUE_NAME_FAST = "shop-runs-fast";
export const QUEUE_NAME_SLOW = "shop-runs-slow";

const FAMILY_QUEUE_NAME: Record<ShopFamily, string> = {
  fast: QUEUE_NAME_FAST,
  slow: QUEUE_NAME_SLOW,
};

const HEARTBEAT_QUEUE = "heartbeat";

interface ShopRunJob {
  shopId: string;
}

const sharedQueues: Map<ShopFamily, Queue<ShopRunJob>> = new Map();

function getQueueFor(family: ShopFamily): Queue<ShopRunJob> {
  const existing = sharedQueues.get(family);
  if (existing) return existing;
  const queue = new Queue<ShopRunJob>(FAMILY_QUEUE_NAME[family], {
    connection: createRedisConnection(),
  });
  sharedQueues.set(family, queue);
  return queue;
}

function allQueues(): Queue<ShopRunJob>[] {
  return [getQueueFor("fast"), getQueueFor("slow")];
}

export async function pauseQueue(): Promise<void> {
  await Promise.all(allQueues().map((q) => q.pause()));
}

export async function resumeQueue(): Promise<void> {
  await Promise.all(allQueues().map((q) => q.resume()));
}

export interface QueueStatus {
  paused: boolean;
  waiting: number;
  active: number;
  delayed: number;
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const queues = allQueues();
  const stats = await Promise.all(
    queues.map(async (q) => {
      const [paused, waiting, active, delayed] = await Promise.all([
        q.isPaused(),
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getDelayedCount(),
      ]);
      return { paused, waiting, active, delayed };
    }),
  );
  return {
    paused: stats.every((s) => s.paused),
    waiting: stats.reduce((sum, s) => sum + s.waiting, 0),
    active: stats.reduce((sum, s) => sum + s.active, 0),
    delayed: stats.reduce((sum, s) => sum + s.delayed, 0),
  };
}

export async function getAllActiveJobs(): Promise<Job<ShopRunJob>[]> {
  const results = await Promise.all(allQueues().map((q) => q.getActive()));
  return results.flat();
}

// Wipes both queues (waiting / delayed / completed / failed history) and
// immediately re-creates the repeatables from the enabled-shops table.
// Used by /admin/reset-listings-events for a true cleanroom state.
export async function resetAllQueues(): Promise<{ obliterated: string[] }> {
  const obliterated: string[] = [];
  for (const q of allQueues()) {
    try {
      await q.obliterate({ force: true });
      obliterated.push(q.name);
    } catch (error) {
      logger.warn({ err: error, queue: q.name }, "queue obliterate failed");
    }
  }
  // Immediately reconcile so the repeatables are back in place — otherwise
  // the next 60s reconcile-tick would have to do it.
  await reconcileRepeatables();
  return { obliterated };
}

export async function triggerShopNow(shopId: string): Promise<string> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`shop ${shopId} not found`);
  const queue = getQueueFor(familyOf(shop));
  const job = await queue.add(
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

// Bricht laufende/wartende Single-Runs eines Shops ab. Wiederkehrende
// (repeatable) Jobs bleiben erhalten — der Shop wird beim nächsten Tick wieder
// normal gepollt; wir killen nur den aktuell hängenden Lauf.
export async function cancelShopRuns(shopId: string): Promise<{ cancelled: number }> {
  let cancelled = 0;
  for (const q of allQueues()) {
    // 1. Wartende/verzögerte Einzel-Jobs entfernen (verhindert Start).
    const pending = [...(await q.getWaiting()), ...(await q.getDelayed())];
    for (const job of pending) {
      if (job.data?.shopId !== shopId) continue;
      if (job.repeatJobKey) continue; // den Repeatable-Trigger nicht anfassen
      try {
        await job.remove();
        cancelled++;
      } catch {
        /* race: schon weg */
      }
    }
    // 2. Aktive Jobs: remove versuchen — klappt bei verwaisten/Phantom-Jobs
    //    sofort. Bei echtem gelocktem Lauf wirft remove → für die slow-Family
    //    den Browser schließen, das killt die wedged Playwright-Seite (slow
    //    läuft mit concurrency 1, betrifft also nur diesen einen Lauf).
    for (const job of await q.getActive()) {
      if (job.data?.shopId !== shopId) continue;
      try {
        await job.remove();
        cancelled++;
      } catch {
        if (q.name === QUEUE_NAME_SLOW) {
          await closeBrowser().catch(() => {});
          cancelled++;
        }
      }
    }
  }
  return { cancelled };
}

async function jobHandler(job: Job<ShopRunJob>) {
  const result = await runShop(job.data.shopId);
  if (result.boostWorthyEvents > 0) {
    triggerCascadeBoost();
    logger.info(
      { events: result.boostWorthyEvents, shopId: result.shopId },
      "cascade boost triggered (NEW_LISTING/RESTOCK)",
    );
  }
  return result;
}

export async function startScheduler(): Promise<{ stop: () => Promise<void> }> {
  // One-shot cleanup: the pre-split deployment had everything in the legacy
  // `shop-runs` queue. Without obliterating it, its repeatables would keep
  // firing delayed jobs that no live worker is listening for.
  try {
    const legacyQueue = new Queue("shop-runs", { connection: createRedisConnection() });
    await legacyQueue.obliterate({ force: true });
    await legacyQueue.close();
    logger.info("legacy shop-runs queue obliterated (pre-split cleanup)");
  } catch (error) {
    logger.warn({ err: error }, "legacy queue cleanup failed (ok if first run)");
  }

  const fastQueue = getQueueFor("fast");
  const slowQueue = getQueueFor("slow");
  const heartbeatQueue = new Queue(HEARTBEAT_QUEUE, { connection: createRedisConnection() });

  // Verwaiste Jobs aus früheren, nicht sauber beendeten Worker-Prozessen
  // wegräumen. Da die App single-instance ist, läuft beim Start KEIN
  // legitimer Worker — jeder `active`-Job ist also ein Zombie eines
  // SIGKILL-beendeten Deploys (sonst zeigt das Dashboard "5× Thalia läuft").
  for (const q of [fastQueue, slowQueue]) {
    try {
      await q.clean(0, 10_000, "active");
      await q.clean(0, 10_000, "wait");
    } catch (error) {
      logger.warn({ err: error, queue: q.name }, "startup orphan-job cleanup failed");
    }
  }

  const fastWorker = new Worker<ShopRunJob>(
    QUEUE_NAME_FAST,
    jobHandler,
    {
      connection: createRedisConnection(),
      concurrency: 3,
      // HTTP adapters complete in 5-30s. 5min lock is generous headroom;
      // anything longer is genuinely stuck and should be released.
      lockDuration: 5 * 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );

  const slowWorker = new Worker<ShopRunJob>(
    QUEUE_NAME_SLOW,
    jobHandler,
    {
      connection: createRedisConnection(),
      concurrency: 1,
      // Playwright adapters can run 100-220s worst case. 10min lock allows
      // them to finish; beyond that the Chromium page is wedged and we
      // want the job released so the next schedule tick can re-run it.
      lockDuration: 10 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 1,
    },
  );

  for (const worker of [fastWorker, slowWorker]) {
    worker.on("failed", (job, err) => {
      logger.error({ err, shopId: job?.data.shopId, jobId: job?.id }, "shop-run job failed");
    });
  }

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

  await reconcileRepeatables();

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
    reconcileRepeatables().catch((err) =>
      logger.error({ err }, "scheduler reconcile failed"),
    );
  }, 60_000);

  return {
    async stop() {
      clearInterval(reconcileTimer);
      // Force-Close: nicht auf laufende Jobs warten (ein Playwright-Run kann
      // bis ~220s dauern; Docker killt nach der Grace-Period). Der dabei
      // abgebrochene Job wird verwaist — das Startup-Cleanup oben putzt ihn
      // beim nächsten Boot weg. So bleibt der Deploy schnell.
      await Promise.all([
        fastWorker.close(true),
        slowWorker.close(true),
        heartbeatWorker.close(true),
      ]);
      await Promise.all([fastQueue.close(), slowQueue.close()]);
      sharedQueues.clear();
      await heartbeatQueue.close();
      await closeBrowser();
    },
  };
}

async function reconcileRepeatables(): Promise<void> {
  const shops = await prisma.shop.findMany({ where: { enabled: true } });
  const desired = new Map<string, { every: number; family: ShopFamily }>();
  for (const shop of shops) {
    const seconds = getCurrentIntervalSeconds(shop);
    desired.set(shop.id, { every: seconds * 1000, family: familyOf(shop) });
  }

  for (const family of ["fast", "slow"] as ShopFamily[]) {
    const queue = getQueueFor(family);
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name !== "shop-run") continue;
      const shopId = job.id ?? "";
      const target = desired.get(shopId);
      const currentEvery = job.every != null ? Number(job.every) : NaN;
      // remove if shop disabled, family changed, or interval changed
      if (!target || target.family !== family || target.every !== currentEvery) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
  }

  // Re-snapshot what's now present after cleanup, then add missing ones
  const present = new Set<string>();
  for (const family of ["fast", "slow"] as ShopFamily[]) {
    const refreshed = await getQueueFor(family).getRepeatableJobs();
    for (const j of refreshed) {
      if (j.name === "shop-run" && j.id) present.add(j.id);
    }
  }

  for (const [shopId, opts] of desired.entries()) {
    if (present.has(shopId)) continue;
    const queue = getQueueFor(opts.family);
    const jobOpts: JobsOptions = {
      repeat: { every: opts.every },
      jobId: shopId,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    };
    await queue.add("shop-run", { shopId }, jobOpts);
    logger.info({ shopId, everyMs: opts.every, family: opts.family }, "shop scheduled");
  }
}
