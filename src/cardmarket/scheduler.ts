import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../scheduler/redis.js";
import { logger } from "../lib/logger.js";
import { refreshCardmarketFiles } from "./downloader.js";
import {
  importPrices,
  importProducts,
  recordSyncStatus,
} from "./importer.js";

const QUEUE_NAME = "cardmarket-sync";
const REPEATABLE_ID = "daily-cardmarket-sync";

interface CardmarketJob {
  manual?: boolean;
  // skip download — useful for the upload endpoint that just dropped fresh
  // files on disk and only wants the import step.
  skipDownload?: boolean;
}

let sharedQueue: Queue<CardmarketJob> | null = null;

function getQueue(): Queue<CardmarketJob> {
  if (!sharedQueue) {
    sharedQueue = new Queue<CardmarketJob>(QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return sharedQueue;
}

export async function triggerCardmarketSyncNow(opts: { skipDownload?: boolean } = {}): Promise<string> {
  const job = await getQueue().add(
    "manual-sync",
    { manual: true, skipDownload: opts.skipDownload ?? false },
    {
      jobId: `manual-${Date.now()}`,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  );
  return String(job.id ?? "");
}

export interface SyncOutcome {
  productsImported: number;
  pricesImported: number;
  pricesBytes?: number;
  productsBytes?: number;
}

export async function runCardmarketSync(opts: { skipDownload?: boolean } = {}): Promise<SyncOutcome> {
  const log = logger.child({ scope: "cm-sync", skipDownload: opts.skipDownload ?? false });
  try {
    let pricesBytes: number | undefined;
    let productsBytes: number | undefined;
    if (!opts.skipDownload) {
      const dl = await refreshCardmarketFiles();
      pricesBytes = dl.pricesBytes;
      productsBytes = dl.productsBytes;
    }

    // Products first — prices reference them via FK.
    const products = await importProducts();
    const prices = await importPrices();

    await recordSyncStatus({ products, prices, error: null });

    log.info(
      {
        productsImported: products.count,
        pricesImported: prices.count,
        pricesBytes,
        productsBytes,
      },
      "cardmarket sync complete",
    );

    return {
      productsImported: products.count,
      pricesImported: prices.count,
      pricesBytes,
      productsBytes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, "cardmarket sync failed");
    await recordSyncStatus({ error: msg }).catch(() => {});
    throw err;
  }
}

export async function startCardmarketScheduler(): Promise<{ stop: () => Promise<void> }> {
  const queue = getQueue();

  const worker = new Worker<CardmarketJob>(
    QUEUE_NAME,
    async (job) => {
      return await runCardmarketSync({ skipDownload: job.data.skipDownload ?? false });
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
      // Imports of 75k rows in chunks can run a few minutes — extend lock.
      lockDuration: 10 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 1,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "cardmarket sync job failed");
  });

  // Daily 04:00 Europe/Berlin (CM regen ~03:00 MESZ for prices, ~11:00 for
  // products — products file will refresh on the *next* day, that's fine).
  await queue.add(
    "daily",
    {},
    {
      repeat: { pattern: "0 4 * * *", tz: "Europe/Berlin" },
      jobId: REPEATABLE_ID,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  );

  logger.info("cardmarket scheduler started (daily 04:00 MESZ)");

  return {
    async stop() {
      await worker.close();
      await queue.close();
      sharedQueue = null;
    },
  };
}
