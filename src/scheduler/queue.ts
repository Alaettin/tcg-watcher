import { Queue, Worker, type Job } from "bullmq";
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
  // Manuell getriggerte Läufe planen sich NICHT selbst neu (sonst entstünde
  // ein zweiter Dauer-Zyklus pro Shop). Self-rescheduling gilt nur für
  // automatisch geplante Jobs.
  manual?: boolean;
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
  // Immediately reconcile so each shop has its circulating job back — otherwise
  // the next 60s reconcile-tick would have to do it.
  await reconcileSchedule();
  return { obliterated };
}

export async function triggerShopNow(shopId: string): Promise<string> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`shop ${shopId} not found`);
  const queue = getQueueFor(familyOf(shop));
  const job = await queue.add(
    "shop-run",
    { shopId, manual: true },
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
  try {
    const result = await runShop(job.data.shopId);
    if (result.boostWorthyEvents > 0) {
      triggerCascadeBoost();
      logger.info(
        { events: result.boostWorthyEvents, shopId: result.shopId },
        "cascade boost triggered (NEW_LISTING/RESTOCK)",
      );
    }
    return result;
  } finally {
    // Self-rescheduling: den nächsten Lauf dieses Shops erst NACH Abschluss
    // einplanen → pro Shop zirkuliert immer nur ein Job, die Queue kann nicht
    // überlaufen. Manuelle Einmal-Trigger ausgenommen.
    if (!job.data.manual) {
      await scheduleNext(job.data.shopId).catch((err) =>
        logger.error({ err, shopId: job.data.shopId }, "scheduleNext failed"),
      );
    }
  }
}

// Plant den nächsten Lauf eines Shops als verzögerten Job ein. Delay =
// aktuelles (ggf. Drop-Day-geboostetes) Intervall. Disabled/gelöschte Shops
// werden nicht neu eingeplant.
async function scheduleNext(shopId: string): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || !shop.enabled) return;
  const family = familyOf(shop);
  const delayMs = getCurrentIntervalSeconds(shop) * 1000;
  await getQueueFor(family).add(
    "shop-run",
    { shopId },
    { delay: delayMs, removeOnComplete: true, removeOnFail: true },
  );
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

  // Harter Reset beider Shop-Queues beim Start. Single-instance: beim Boot
  // läuft kein legitimer Worker, also ist alles (active-Zombies, der
  // aufgestaute waiting-Backlog UND die alten fixen Repeatable-Definitionen)
  // Altlast. obliterate räumt alles weg; danach bootstrappen wir frisch je
  // einen self-rescheduling Job pro Shop. Das beendet sowohl die
  // "5× Thalia"-Phantome als auch den waiting-Überlauf.
  for (const q of [fastQueue, slowQueue]) {
    try {
      await q.obliterate({ force: true });
    } catch (error) {
      logger.warn({ err: error, queue: q.name }, "startup queue obliterate failed");
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

  await reconcileSchedule();

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
    reconcileSchedule().catch((err) =>
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

// Sicherheitsnetz (alle 60s + beim Boot): stellt sicher, dass jeder enabled
// Shop GENAU einen zirkulierenden Job hat. Im Normalbetrieb sorgt das
// Self-Rescheduling (scheduleNext nach jedem Lauf) dafür; reconcileSchedule
// heilt nur Lücken (nach Boot, Cancel, Crash) und räumt Jobs disabled/falsch
// einsortierter Shops weg. Keine fixen repeat:{every} mehr → kein Überlauf.
async function reconcileSchedule(): Promise<void> {
  const enabledShops = await prisma.shop.findMany({ where: { enabled: true } });
  const enabledById = new Map(enabledShops.map((s) => [s.id, s]));

  const presentByFamily: Record<ShopFamily, Set<string>> = {
    fast: new Set(),
    slow: new Set(),
  };

  for (const family of ["fast", "slow"] as ShopFamily[]) {
    const queue = getQueueFor(family);
    const jobs = [
      ...(await queue.getWaiting()),
      ...(await queue.getDelayed()),
      ...(await queue.getActive()),
    ];
    for (const job of jobs) {
      const shopId = job.data?.shopId;
      if (!shopId) continue;
      const shop = enabledById.get(shopId);
      // Job eines disabled Shops ODER in der falschen Family-Queue (adapterType
      // geändert) → entfernen. (Aktive/gelockte Jobs lassen sich nicht
      // entfernen — egal, sie laufen aus und planen sich korrekt neu.)
      if (!shop || familyOf(shop) !== family) {
        await job.remove().catch(() => {});
        continue;
      }
      presentByFamily[family].add(shopId);
    }
  }

  // Fehlende enabled Shops einplanen — gestaffelt, um beim Boot keinen
  // Thundering-Herd zu erzeugen.
  let stagger = 0;
  for (const shop of enabledShops) {
    const family = familyOf(shop);
    if (presentByFamily[family].has(shop.id)) continue;
    const delayMs = stagger * 1500;
    stagger++;
    await getQueueFor(family).add(
      "shop-run",
      { shopId: shop.id },
      { delay: delayMs, removeOnComplete: true, removeOnFail: true },
    );
    logger.info({ shopId: shop.id, family, delayMs }, "shop scheduled");
  }
}
