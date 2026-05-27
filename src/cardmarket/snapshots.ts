import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * Append-only Tages-Schnappschuss aller Preise in CardmarketPriceSnapshot
 * schreiben (cm.md §6 Step 4). Quelle ist die latest-Cache-Tabelle
 * CardmarketPrice — eine einzige SQL-Anweisung, keine RAM-Last.
 *
 * ON CONFLICT DO NOTHING macht den Step idempotent: ein zweiter Sync am
 * selben Tag erzeugt keine Duplikate.
 */
export async function insertDailySnapshots(today: Date): Promise<number> {
  const log = logger.child({ scope: "cm-snapshots", snapshotDate: today.toISOString().slice(0, 10) });

  // Date-Truncation: PostgreSQL erwartet ein DATE — bei TIMESTAMP wird der
  // Zeitanteil verworfen. Wir konvertieren explizit auf YYYY-MM-DD-String.
  const isoDate = today.toISOString().slice(0, 10);

  const result = await prisma.$executeRaw`
    INSERT INTO "CardmarketPriceSnapshot"
      ("idProduct","snapshotDate","low","avg","trend","avg1","avg7","avg30")
    SELECT
      "idProduct",
      ${isoDate}::date,
      "low",
      "avg",
      "trend",
      "avg1",
      "avg7",
      "avg30"
    FROM "CardmarketPrice"
    ON CONFLICT ("idProduct","snapshotDate") DO NOTHING
  `;

  log.info({ inserted: result }, "daily snapshots inserted");
  return Number(result);
}

/**
 * Heutige UTC-Mitternacht. Der Sync läuft 04:00 Europe/Berlin (cm.md §6) — zu
 * dieser Zeit ist UTC bereits am gleichen Tag, also `new Date()` würde gehen.
 * Wir trunkieren hier explizit auf den Tagesanfang, damit Tests deterministisch
 * sind und der Snapshot-Date immer ein reines Date ohne Zeitkomponente ist.
 */
export function todayAsDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
