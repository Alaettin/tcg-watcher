import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../scheduler/redis.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { refreshCardmarketFiles } from "./downloader.js";
import {
  importPrices,
  importProducts,
  recordSyncStatus,
} from "./importer.js";
import { importExpansions } from "./expansionsImporter.js";
import { insertDailySnapshots, todayAsDate } from "./snapshots.js";
import { computeAndStoreSignals } from "./computeSignals.js";

const QUEUE_NAME = "cardmarket-sync";
const REPEATABLE_ID = "daily-cardmarket-sync";

interface CardmarketJob {
  manual?: boolean;
  // skip download — useful for the upload endpoint that just dropped fresh
  // files on disk and only wants the import step.
  skipDownload?: boolean;
  // skip Steps 1-4: nur Signale neu berechnen aus existierenden Snapshots.
  // Wird vom recompute-signals-Endpoint nach Schwellwert-Änderungen genutzt.
  signalsOnly?: boolean;
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

export async function triggerCardmarketSyncNow(
  opts: { skipDownload?: boolean; signalsOnly?: boolean } = {},
): Promise<string> {
  const job = await getQueue().add(
    "manual-sync",
    {
      manual: true,
      skipDownload: opts.skipDownload ?? false,
      signalsOnly: opts.signalsOnly ?? false,
    },
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
  snapshotsInserted: number;
  signalsComputed: number;
  expansionsImported: number;
  pricesBytes?: number;
  productsBytes?: number;
}

export async function runCardmarketSync(
  opts: { skipDownload?: boolean; signalsOnly?: boolean } = {},
): Promise<SyncOutcome> {
  const log = logger.child({
    scope: "cm-sync",
    skipDownload: opts.skipDownload ?? false,
    signalsOnly: opts.signalsOnly ?? false,
  });

  // Step 7 — Log eröffnen.
  const logEntry = await prisma.cardmarketSyncLog.create({
    data: { startedAt: new Date(), status: "running" },
  });
  const startTs = Date.now();

  let outcome: SyncOutcome = {
    productsImported: 0,
    pricesImported: 0,
    snapshotsInserted: 0,
    signalsComputed: 0,
    expansionsImported: 0,
  };

  try {
    if (opts.signalsOnly) {
      // Recompute-Pfad: Snapshots bleiben, nur Step 5 läuft.
      const today = todayAsDate();
      outcome.signalsComputed = await computeAndStoreSignals(today);
    } else {
      // Step 1 + 2 — download (kann übersprungen werden, wenn Files via Upload kamen).
      let pricesBytes: number | undefined;
      let productsBytes: number | undefined;
      if (!opts.skipDownload) {
        const dl = await refreshCardmarketFiles();
        pricesBytes = dl.pricesBytes;
        productsBytes = dl.productsBytes;
      }
      outcome.pricesBytes = pricesBytes;
      outcome.productsBytes = productsBytes;

      // Step 3 — Products upserten. FK-Constraint zu Prices hängt daran.
      const products = await importProducts();
      outcome.productsImported = products.count;

      // Step 3b — Expansions opportunistisch (aus File oder Bootstrap-Fallback).
      const expansions = await importExpansions();
      outcome.expansionsImported = expansions.count;

      // Step 3c — Prices upserten (latest cache).
      const prices = await importPrices();
      outcome.pricesImported = prices.count;

      // Step 4 — Snapshot in append-only-Tabelle.
      const today = todayAsDate();
      outcome.snapshotsInserted = await insertDailySnapshots(today);

      // Step 5 — Signale berechnen + Set-Kontext-MV refreshen.
      outcome.signalsComputed = await computeAndStoreSignals(today);

      // Singleton-Status für UI weiter pflegen.
      await recordSyncStatus({ products, prices, error: null });
    }

    // Step 7 — Log abschließen.
    await prisma.cardmarketSyncLog.update({
      where: { id: logEntry.id },
      data: {
        finishedAt: new Date(),
        status: "ok",
        productsCount: outcome.productsImported,
        snapshotsCount: outcome.snapshotsInserted,
        signalsCount: outcome.signalsComputed,
        expansionsCount: outcome.expansionsImported,
        durationMs: Date.now() - startTs,
      },
    });

    log.info(outcome, "cardmarket sync complete");
    return outcome;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, "cardmarket sync failed");

    await prisma.cardmarketSyncLog.update({
      where: { id: logEntry.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        errorMsg: msg.slice(0, 2000),
        productsCount: outcome.productsImported || null,
        snapshotsCount: outcome.snapshotsInserted || null,
        signalsCount: outcome.signalsComputed || null,
        expansionsCount: outcome.expansionsImported || null,
        durationMs: Date.now() - startTs,
      },
    }).catch(() => {});
    await recordSyncStatus({ error: msg }).catch(() => {});
    throw err;
  }
}

export async function startCardmarketScheduler(): Promise<{ stop: () => Promise<void> }> {
  const queue = getQueue();

  const worker = new Worker<CardmarketJob>(
    QUEUE_NAME,
    async (job) => {
      return await runCardmarketSync({
        skipDownload: job.data.skipDownload ?? false,
        signalsOnly: job.data.signalsOnly ?? false,
      });
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
      // Sync läuft jetzt Snapshot+Compute Signals — kann mehrere Minuten dauern.
      lockDuration: 15 * 60_000,
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
