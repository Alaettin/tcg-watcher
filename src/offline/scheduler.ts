import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../scheduler/redis.js";
import { logger } from "../lib/logger.js";
import { getProspekteConfig } from "../lib/settings.js";
import { getOfflineAdapters } from "./registry.js";
import { isPokemonHit } from "./matcher.js";
import { detectAndPersistOffline } from "./detector.js";
import { notifyOfflineEvents } from "./sink.js";

const QUEUE_NAME = "offline-deals";
const REPEATABLE_ID = "daily-offline-poll";

interface OfflineJob {
  manual?: boolean;
}

let sharedQueue: Queue<OfflineJob> | null = null;

function getQueue(): Queue<OfflineJob> {
  if (!sharedQueue) {
    sharedQueue = new Queue<OfflineJob>(QUEUE_NAME, { connection: createRedisConnection() });
  }
  return sharedQueue;
}

export async function triggerProspekteNow(): Promise<string> {
  const job = await getQueue().add(
    "manual-poll",
    { manual: true },
    {
      jobId: `manual-${Date.now()}`,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  );
  return String(job.id ?? "");
}

async function runOfflinePoll(manual: boolean): Promise<{ dealsFound: number; eventsFired: number }> {
  const log = logger.child({ scope: "offline-poll", manual });
  const config = await getProspekteConfig();
  if (!config.enabled) {
    log.info("prospekte disabled — skipping poll");
    return { dealsFound: 0, eventsFired: 0 };
  }

  const adapters = getOfflineAdapters();
  let totalHits = 0;
  let totalEvents = 0;

  for (const adapter of adapters) {
    try {
      const start = Date.now();
      const raw = await adapter.search(config.searchQueries, config.postalCodes);
      const hits = raw.filter((d) => isPokemonHit(d, config.negativeTerms));
      log.info(
        { source: adapter.source, raw: raw.length, hits: hits.length, durationMs: Date.now() - start },
        "offline adapter completed",
      );
      totalHits += hits.length;
      const events = await detectAndPersistOffline(adapter.source, hits);
      await notifyOfflineEvents(events);
      totalEvents += events.length;
    } catch (error) {
      log.error({ err: error, source: adapter.source }, "offline adapter failed");
    }
  }

  log.info({ totalHits, totalEvents }, "offline poll done");
  return { dealsFound: totalHits, eventsFired: totalEvents };
}

export async function startOfflineScheduler(): Promise<{ stop: () => Promise<void> }> {
  const queue = getQueue();

  const worker = new Worker<OfflineJob>(
    QUEUE_NAME,
    async (job) => {
      return await runOfflinePoll(job.data.manual ?? false);
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
      lockDuration: 5 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 1,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "offline poll job failed");
  });

  // Daily 07:00 Europe/Berlin
  await queue.add(
    "daily",
    {},
    {
      repeat: { pattern: "0 7 * * *", tz: "Europe/Berlin" },
      jobId: REPEATABLE_ID,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  );

  logger.info("offline scheduler started (daily 07:00 MESZ)");

  return {
    async stop() {
      await worker.close();
      await queue.close();
      sharedQueue = null;
    },
  };
}
