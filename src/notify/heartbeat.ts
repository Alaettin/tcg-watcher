import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAllActiveJobs } from "../scheduler/queue.js";
import { getCurrentIntervalSeconds } from "../scheduler/dropDay.js";
import { sendNtfyRaw } from "./ntfy.js";

export interface ShopRunStats {
  completedAt: string;
  durationMs: number;
  listingsFound: number;
  matched: number;
  events: number;
  newListings: number;
  restocks: number;
}

export interface CurrentlyRunning {
  shopId: string;
  displayName: string;
  adapterType: string;
  startedAt: string | null;
  elapsedMs: number;
}

export interface RecentRun {
  shopId: string;
  displayName: string;
  adapterType: string;
  completedAt: string | null;
  durationMs: number;
  listingsFound: number;
  matched: number;
  events: number;
  newListings: number;
  restocks: number;
  online: boolean;
}

export interface HeartbeatSnapshot {
  shops: Array<{ id: string; displayName: string; lastSuccessfulRun: Date | null; enabled: boolean }>;
  enabledCount: number;
  totalShopCount: number;
  onlineCount: number;
  offlineCount: number;
  listingCount: number;
  activeSetCount: number;
  totalSetCount: number;
  events24h: Array<{ type: string; count: number }>;
  totalEvents24h: number;
  currentlyRunning: CurrentlyRunning[];
  recentRuns: RecentRun[];
}

function ago(date: Date | null): string {
  if (!date) return "nie";
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `vor ${sec}s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `vor ${Math.floor(sec / 3600)}h`;
  return `vor ${Math.floor(sec / 86400)}d`;
}

function isStatsShape(value: unknown): value is ShopRunStats {
  return (
    typeof value === "object" &&
    value !== null &&
    "completedAt" in value &&
    typeof (value as { completedAt: unknown }).completedAt === "string"
  );
}

async function collectCurrentlyRunning(
  shopMap: Map<string, { displayName: string; adapterType: string }>,
): Promise<CurrentlyRunning[]> {
  try {
    const active = await getAllActiveJobs();
    const now = Date.now();
    return active
      .map((job) => {
        const shopId = (job.data as { shopId?: string }).shopId ?? "";
        const meta = shopMap.get(shopId);
        if (!meta) return null;
        const startedAt = job.processedOn ?? null;
        return {
          shopId,
          displayName: meta.displayName,
          adapterType: meta.adapterType,
          startedAt: startedAt ? new Date(startedAt).toISOString() : null,
          elapsedMs: startedAt ? now - startedAt : 0,
        } as CurrentlyRunning;
      })
      .filter((x): x is CurrentlyRunning => x !== null);
  } catch (error) {
    logger.warn({ err: error }, "could not list currently running jobs");
    return [];
  }
}

export async function collectHeartbeat(): Promise<HeartbeatSnapshot> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const now = Date.now();

  const [allShops, events24h, listingCount, activeSetCount, totalSetCount] = await Promise.all([
    prisma.shop.findMany({ orderBy: { id: "asc" } }),
    prisma.event.groupBy({
      by: ["type"],
      where: { createdAt: { gt: since } },
      _count: { _all: true },
    }),
    prisma.listing.count(),
    prisma.set.count({ where: { active: true } }),
    prisma.set.count(),
  ]);

  const enabledShops = allShops.filter((s) => s.enabled);
  const shopMap = new Map(
    allShops.map((s) => [s.id, { displayName: s.displayName, adapterType: s.adapterType }]),
  );

  const currentlyRunning = await collectCurrentlyRunning(shopMap);

  let onlineCount = 0;
  let offlineCount = 0;
  const recentRuns: RecentRun[] = enabledShops.map((s) => {
    const effectiveS = getCurrentIntervalSeconds(s);
    const online = s.lastSuccessfulRun
      ? now - s.lastSuccessfulRun.getTime() < effectiveS * 3 * 1000
      : false;
    if (online) onlineCount++;
    else offlineCount++;

    const stats = isStatsShape(s.lastRunStats) ? s.lastRunStats : null;
    return {
      shopId: s.id,
      displayName: s.displayName,
      adapterType: s.adapterType,
      completedAt: stats?.completedAt ?? s.lastSuccessfulRun?.toISOString() ?? null,
      durationMs: stats?.durationMs ?? 0,
      listingsFound: stats?.listingsFound ?? 0,
      matched: stats?.matched ?? 0,
      events: stats?.events ?? 0,
      newListings: stats?.newListings ?? 0,
      restocks: stats?.restocks ?? 0,
      online,
    };
  });

  recentRuns.sort((a, b) => {
    if (!a.completedAt && !b.completedAt) return 0;
    if (!a.completedAt) return 1;
    if (!b.completedAt) return -1;
    return b.completedAt.localeCompare(a.completedAt);
  });

  return {
    shops: allShops.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      lastSuccessfulRun: s.lastSuccessfulRun,
      enabled: s.enabled,
    })),
    enabledCount: enabledShops.length,
    totalShopCount: allShops.length,
    onlineCount,
    offlineCount,
    listingCount,
    activeSetCount,
    totalSetCount,
    events24h: events24h.map((e) => ({ type: e.type, count: e._count._all })),
    totalEvents24h: events24h.reduce((sum, e) => sum + e._count._all, 0),
    currentlyRunning,
    recentRuns,
  };
}

export async function sendDailyHeartbeat(): Promise<void> {
  const snap = await collectHeartbeat();

  const enabledShops = snap.shops.filter((s) => s.enabled);
  const shopLines = enabledShops.map((s) => `• ${s.id}: ${ago(s.lastSuccessfulRun)}`);
  const eventLines = snap.events24h.length === 0
    ? ["keine Events in den letzten 24h"]
    : snap.events24h.map((e) => `• ${e.type}: ${e.count}`);

  const message = [
    `${snap.enabledCount} Shops aktiv (${snap.onlineCount} online / ${snap.offlineCount} stale), ${snap.listingCount} Listings getrackt.`,
    "",
    "Letzte Runs:",
    ...shopLines,
    "",
    "Events letzte 24h:",
    ...eventLines,
  ].join("\n");

  logger.info({ shops: snap.enabledCount, events24h: snap.totalEvents24h }, "heartbeat sent");

  await sendNtfyRaw({
    title: "Pokemon Watcher — Heartbeat",
    message,
    priority: 2,
    tags: ["heartbeat"],
  });
}
