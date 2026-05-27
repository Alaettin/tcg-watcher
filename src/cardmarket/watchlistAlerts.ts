import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { sendNtfyRaw } from "../notify/ntfy.js";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "https://watcher.adogan.de";
const COOLDOWN_HOURS = 24;

type AlertKind = "below" | "above" | "flip";

/**
 * Row aus der Watchlist-Scan-Query. Joint Watchlist + Produkt + aktueller
 * Preis + heutiges Signal in einem Roundtrip.
 */
interface ScanRow {
  id: bigint;
  idProduct: number;
  name: string;
  categoryName: string;
  alertBelowTrend: number | null;
  alertAboveTrend: number | null;
  alertOnSignalFlip: boolean;
  lastNotifiedRecommendation: string | null;
  trendNow: number | null;
  recommendationToday: string | null;
  headlineToday: string | null;
}

export interface WatchlistAlertResult {
  itemsScanned: number;
  triggered: number;
}

/**
 * Step 6 aus cm.md §6 — für jedes Watchlist-Item das nicht in der 24h-
 * Cooldown-Periode steckt, prüfen ob ein Alert fällig ist (Schwellwert oder
 * Signal-Flip) und ggf. via ntfy pushen.
 */
export async function triggerWatchlistAlerts(today: Date): Promise<WatchlistAlertResult> {
  const log = logger.child({ scope: "cm-watchlist-alerts" });
  const isoDate = today.toISOString().slice(0, 10);

  const rows = await prisma.$queryRaw<ScanRow[]>`
    SELECT
      w."id",
      w."idProduct",
      p."name",
      p."categoryName",
      w."alertBelowTrend",
      w."alertAboveTrend",
      w."alertOnSignalFlip",
      w."lastNotifiedRecommendation",
      pr."trend"           AS "trendNow",
      s."recommendation"   AS "recommendationToday",
      s."headline"         AS "headlineToday"
    FROM "CardmarketWatchlistItem" w
    JOIN "CardmarketProduct" p   ON p."idProduct" = w."idProduct"
    LEFT JOIN "CardmarketPrice" pr ON pr."idProduct" = w."idProduct"
    LEFT JOIN "CardmarketSignal" s ON s."idProduct" = w."idProduct"
                                  AND s."snapshotDate" = ${isoDate}::date
    WHERE w."lastAlertSentAt" IS NULL
       OR w."lastAlertSentAt" < NOW() - (${COOLDOWN_HOURS}::int * INTERVAL '1 hour')
  `;

  let triggered = 0;

  for (const row of rows) {
    const decision = decideAlert(row);
    if (!decision) continue;

    try {
      await sendCardmarketAlert({
        kind: decision.kind,
        idProduct: row.idProduct,
        name: row.name,
        trendNow: row.trendNow,
        threshold: decision.threshold,
        prevRec: row.lastNotifiedRecommendation ?? null,
        newRec: row.recommendationToday ?? null,
        headline: row.headlineToday ?? null,
      });

      await prisma.cardmarketWatchlistItem.update({
        where: { id: row.id },
        data: {
          lastAlertSentAt: new Date(),
          // Auch bei Schwellwert-Alerts den aktuellen Stand snappen, damit
          // der nächste Signal-Flip-Vergleich konsistent ist.
          lastNotifiedRecommendation:
            row.recommendationToday ?? row.lastNotifiedRecommendation ?? null,
        },
      });

      triggered++;
      log.info(
        {
          idProduct: row.idProduct,
          kind: decision.kind,
          trendNow: row.trendNow,
          threshold: decision.threshold,
        },
        "watchlist alert sent",
      );
    } catch (err) {
      log.warn({ err, idProduct: row.idProduct }, "watchlist alert send failed");
    }
  }

  log.info({ itemsScanned: rows.length, triggered }, "watchlist alerts pass complete");
  return { itemsScanned: rows.length, triggered };
}

interface AlertDecision {
  kind: AlertKind;
  threshold?: number;
}

/**
 * Reihenfolge: Schwellwerte schlagen Signal-Flip — wenn der Trend reisst,
 * willst du das primär wissen, der Flip ist Sekundär-Info. Wenn beides
 * gleichzeitig zutrifft, fliegt der Schwellwert-Push raus; der Flip wird
 * via lastNotifiedRecommendation-Update mit weggespeichert, also kein
 * zweiter Push beim nächsten Sync.
 */
function decideAlert(row: ScanRow): AlertDecision | null {
  if (row.trendNow != null) {
    if (row.alertBelowTrend != null && row.trendNow <= row.alertBelowTrend) {
      return { kind: "below", threshold: row.alertBelowTrend };
    }
    if (row.alertAboveTrend != null && row.trendNow >= row.alertAboveTrend) {
      return { kind: "above", threshold: row.alertAboveTrend };
    }
  }
  if (
    row.alertOnSignalFlip &&
    row.recommendationToday != null &&
    row.lastNotifiedRecommendation != null &&
    row.recommendationToday !== row.lastNotifiedRecommendation
  ) {
    return { kind: "flip" };
  }
  return null;
}

function formatEur(value: number | null): string {
  if (value == null) return "n/a";
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

async function sendCardmarketAlert(args: {
  kind: AlertKind;
  idProduct: number;
  name: string;
  trendNow: number | null;
  threshold: number | undefined;
  prevRec: string | null;
  newRec: string | null;
  headline: string | null;
}): Promise<void> {
  const productUrl = `${PUBLIC_BASE_URL.replace(/\/+$/, "")}/cardmarket/p/${args.idProduct}`;
  const trendStr = formatEur(args.trendNow);
  const thrStr = formatEur(args.threshold ?? null);

  let title: string;
  let message: string;
  let priority: number;
  let tags: string[];

  switch (args.kind) {
    case "below":
      title = `📉 Watchlist: ${args.name}`;
      message = `trend ${trendStr} ≤ ${thrStr} — Kauf-Fenster offen`;
      priority = 4;
      tags = ["chart_with_downwards_trend", "moneybag"];
      break;
    case "above":
      title = `📈 Watchlist: ${args.name}`;
      message = `trend ${trendStr} ≥ ${thrStr} — Verkaufs-Schwelle erreicht`;
      priority = 4;
      tags = ["chart_with_upwards_trend", "moneybag"];
      break;
    case "flip":
      title = `🔄 Watchlist: ${args.name}`;
      message = args.headline
        ? `Signal ${args.prevRec ?? "?"} → ${args.newRec ?? "?"}: ${args.headline}`
        : `Signal ${args.prevRec ?? "?"} → ${args.newRec ?? "?"}`;
      priority = 3;
      tags = ["arrows_counterclockwise", "bell"];
      break;
  }

  await sendNtfyRaw({
    title,
    message,
    priority,
    tags,
    click: productUrl,
    actions: [
      { action: "view", label: "Produkt öffnen", url: productUrl, clear: true },
    ],
  });
}
