import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { computeSignalForProduct } from "./signals/index.js";
import type { SetContext, SignalInput } from "./signals/index.js";

const BATCH_SIZE = 2000;

/**
 * Eine Row aus dem LATERAL-Query unten. Felder kommen direkt aus
 * CardmarketPriceSnapshot von heute + zwei Snapshot-Lookups via LATERAL-Joins.
 */
interface SignalCalcRow {
  idProduct: number;
  idExpansion: number;
  trend: number | null;
  avg: number | null;
  low: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  trend7: number | null;
  trend30: number | null;
  snapCount: number;
  rangePct: number | null;
}

/**
 * Step 5 aus cm.md §6: für jedes Produkt im heutigen Snapshot Δ7/Δ30, L, M,
 * movement_class, recommendation, reasoning + sample_quality berechnen und in
 * CardmarketSignal bulk-upserten.
 *
 * Cursor-basiert (idProduct als Cursor) in 2000er-Batches — RAM-Footprint
 * bleibt konstant unabhängig von der Total-Anzahl Produkte.
 *
 * Set-Kontext wird einmalig vor dem Loop geladen (idExpansion → SetContext)
 * und beim Reasoning-Build pro Row gejoint.
 */
export async function computeAndStoreSignals(today: Date): Promise<number> {
  const log = logger.child({
    scope: "cm-compute-signals",
    snapshotDate: today.toISOString().slice(0, 10),
  });
  const isoDate = today.toISOString().slice(0, 10);

  // Vorab: Set-Kontext für alle Sets aus der Materialized View. Bei erstem
  // Run nach Migration ist die MV noch leer (REFRESH läuft erst am Ende von
  // Step 5) — dann sind alle medianL/Δ7 null, der erste Tag hat keinen
  // Set-Kontext im Reasoning. Ab Tag 2 funktioniert es.
  const setContextMap = await loadSetContextMap();
  log.info({ setCount: setContextMap.size }, "set context loaded");

  // Expansions-Namen einmalig laden (für Reasoning-Templates).
  const expansionNames = await loadExpansionNames();

  let cursor = 0;
  let totalSignals = 0;
  let batchNum = 0;

  while (true) {
    const rows = await prisma.$queryRaw<SignalCalcRow[]>`
      SELECT
        t."idProduct",
        p."idExpansion",
        t."trend",
        t."avg",
        t."low",
        t."avg1",
        t."avg7",
        t."avg30",
        s7."trend" AS "trend7",
        s30."trend" AS "trend30",
        sc."snapCount",
        sc."rangePct"
      FROM "CardmarketPriceSnapshot" t
      JOIN "CardmarketProduct" p ON p."idProduct" = t."idProduct"
      LEFT JOIN LATERAL (
        SELECT "trend" FROM "CardmarketPriceSnapshot"
        WHERE "idProduct" = t."idProduct"
          AND "snapshotDate" <= ${isoDate}::date - INTERVAL '7 days'
        ORDER BY "snapshotDate" DESC
        LIMIT 1
      ) s7 ON true
      LEFT JOIN LATERAL (
        SELECT "trend" FROM "CardmarketPriceSnapshot"
        WHERE "idProduct" = t."idProduct"
          AND "snapshotDate" <= ${isoDate}::date - INTERVAL '30 days'
        ORDER BY "snapshotDate" DESC
        LIMIT 1
      ) s30 ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS "snapCount",
          CASE
            WHEN percentile_cont(0.5) WITHIN GROUP (ORDER BY "trend") > 0
              THEN (MAX("trend") - MIN("trend")) / percentile_cont(0.5) WITHIN GROUP (ORDER BY "trend")
            ELSE NULL
          END AS "rangePct"
        FROM "CardmarketPriceSnapshot"
        WHERE "idProduct" = t."idProduct"
          AND "snapshotDate" > ${isoDate}::date - INTERVAL '7 days'
      ) sc ON true
      WHERE t."snapshotDate" = ${isoDate}::date
        AND t."idProduct" > ${cursor}
      ORDER BY t."idProduct"
      LIMIT ${BATCH_SIZE}
    `;

    if (rows.length === 0) break;

    // Letztes idProduct als nächster Cursor — `ORDER BY idProduct` garantiert
    // monotonen Fortschritt, kein Re-Scan.
    cursor = rows[rows.length - 1]!.idProduct;
    batchNum++;

    // Pure compute pro Row (alle Funktionen in src/cardmarket/signals/).
    const computed = rows.map((row) => {
      const input: SignalInput = {
        trend: row.trend,
        avg: row.avg,
        low: row.low,
        avg1: row.avg1,
        avg7: row.avg7,
        avg30: row.avg30,
        trend7dAgo: row.trend7,
        trend30dAgo: row.trend30,
        snapshotCount: row.snapCount ?? 0,
        snapshotRangePct: row.rangePct,
      };
      const ctx = setContextMap.get(row.idExpansion);
      const setContext: SetContext | null = ctx
        ? {
            idExpansion: row.idExpansion,
            expansionName: expansionNames.get(row.idExpansion) ?? null,
            productCount: ctx.productCount,
            medianL: ctx.medianL,
            medianDelta7: ctx.medianDelta7,
            volatilityDelta7: ctx.volatilityDelta7,
          }
        : null;
      const signal = computeSignalForProduct(input, setContext);
      return { idProduct: row.idProduct, signal };
    });

    await bulkUpsertSignals(today, computed);
    totalSignals += computed.length;
  }

  log.info({ batches: batchNum, total: totalSignals }, "signals computed and stored");

  // Set-Kontext für morgen frisch berechnen.
  await refreshSetSignalView();
  log.info("set signal materialized view refreshed");

  return totalSignals;
}

interface ComputedSignal {
  idProduct: number;
  signal: ReturnType<typeof computeSignalForProduct>;
}

async function bulkUpsertSignals(today: Date, computed: ComputedSignal[]): Promise<void> {
  if (computed.length === 0) return;
  const isoDate = today.toISOString().slice(0, 10);

  const values = computed.map(({ idProduct, signal }) => {
    return Prisma.sql`(${idProduct}, ${isoDate}::date, ${signal.lScore}, ${signal.mScore}, ${signal.delta7}, ${signal.delta30}, ${signal.movementClass}, ${signal.recommendation}, ${signal.headline}, ${JSON.stringify(signal.reasoningLines)}::jsonb, ${signal.sampleQuality}, NOW())`;
  });

  await prisma.$executeRaw`
    INSERT INTO "CardmarketSignal"
      ("idProduct","snapshotDate","lScore","mScore","delta7","delta30","movementClass","recommendation","headline","reasoningLines","sampleQuality","computedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("idProduct","snapshotDate") DO UPDATE SET
      "lScore" = EXCLUDED."lScore",
      "mScore" = EXCLUDED."mScore",
      "delta7" = EXCLUDED."delta7",
      "delta30" = EXCLUDED."delta30",
      "movementClass" = EXCLUDED."movementClass",
      "recommendation" = EXCLUDED."recommendation",
      "headline" = EXCLUDED."headline",
      "reasoningLines" = EXCLUDED."reasoningLines",
      "sampleQuality" = EXCLUDED."sampleQuality",
      "computedAt" = EXCLUDED."computedAt"
  `;
}

interface SetContextRow {
  idExpansion: number;
  productCount: number;
  medianL: number | null;
  medianDelta7: number | null;
  volatilityDelta7: number | null;
}

async function loadSetContextMap(): Promise<Map<number, SetContextRow>> {
  // Wir nehmen den jüngsten verfügbaren Snapshot pro Set aus der MV.
  // Bei erstem Run nach Migration ist die MV leer → Map bleibt leer, ok.
  const rows = await prisma.$queryRaw<SetContextRow[]>`
    SELECT DISTINCT ON ("idExpansion")
      "idExpansion",
      "productCount",
      "medianL",
      "medianDelta7",
      "volatilityDelta7"
    FROM "CardmarketSetSignalDaily"
    ORDER BY "idExpansion", "snapshotDate" DESC
  `;
  const map = new Map<number, SetContextRow>();
  for (const row of rows) {
    map.set(row.idExpansion, row);
  }
  return map;
}

async function loadExpansionNames(): Promise<Map<number, string>> {
  const rows = await prisma.cardmarketExpansion.findMany({
    select: { idExpansion: true, name: true },
  });
  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(row.idExpansion, row.name);
  }
  return map;
}

/**
 * Materialized View neu aufbauen. CONCURRENTLY benötigt den UNIQUE INDEX
 * (in der Migration angelegt). Beim allerersten Refresh nach Anlegen der MV
 * kann CONCURRENTLY fehlschlagen wenn die MV noch nie populated wurde — dann
 * fallback auf non-concurrent.
 */
async function refreshSetSignalView(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      'REFRESH MATERIALIZED VIEW CONCURRENTLY "CardmarketSetSignalDaily"',
    );
  } catch (err) {
    logger.warn(
      { err },
      "concurrent refresh failed (likely never populated); falling back to plain refresh",
    );
    await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW "CardmarketSetSignalDaily"');
  }
}
