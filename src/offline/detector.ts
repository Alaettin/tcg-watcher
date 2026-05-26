import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import type { OfflineRawDeal } from "./OfflineAdapter.js";

export type OfflineEventType = "NEW_DEAL" | "PRICE_DROP" | "EXPIRING_SOON" | "WENT_AWAY";

export interface DetectedOfflineEvent {
  dealId: string;
  type: OfflineEventType;
  deal: {
    title: string;
    retailerId: string;
    priceEur: number | null;
    originalPriceEur: number | null;
    validFrom: Date;
    validUntil: Date;
    sourceUrl: string | null;
    imageUrl: string | null;
    postalCode: string | null;
    storeCity: string | null;
    storeName: string | null;
    storeAddress: string | null;
  };
  detail: Record<string, unknown>;
}

const EXPIRING_THRESHOLD_HOURS = 48;
const DEDUP_EVENT_WINDOW_HOURS = 24;

/**
 * Persist fresh deals + emit detected events. Strategy:
 *   1. Upsert OfflineDeal by (source, sourceDealId). New row → NEW_DEAL.
 *   2. If price dropped vs. last seen price → PRICE_DROP.
 *   3. Deals already in DB for this source that AREN'T in the fresh batch
 *      and were last seen >24h ago → WENT_AWAY.
 *   4. validUntil within 48h and no EXPIRING_SOON event in last 24h → EXPIRING_SOON.
 *
 * Dedup: 24h window per (dealId, type) — prevents repeated pushes.
 */
export async function detectAndPersistOffline(
  source: string,
  fresh: OfflineRawDeal[],
): Promise<DetectedOfflineEvent[]> {
  const log = logger.child({ source, freshCount: fresh.length });
  const now = new Date();
  const events: DetectedOfflineEvent[] = [];

  // Pre-load existing deals for this source for diff
  const existing = await prisma.offlineDeal.findMany({
    where: { source },
    select: {
      id: true,
      sourceDealId: true,
      priceEur: true,
      validUntil: true,
      lastSeenAt: true,
    },
  });
  const existingById = new Map(existing.map((d) => [d.sourceDealId, d]));
  const freshIds = new Set(fresh.map((d) => d.sourceDealId));

  // 1+2: upsert each fresh deal, emit NEW_DEAL or PRICE_DROP
  for (const raw of fresh) {
    const prior = existingById.get(raw.sourceDealId);

    // Ensure retailer row exists (auto-create stub if marktguru returns an
    // unknown one — seed has the common 30, but new ones can crop up).
    await prisma.offlineRetailer.upsert({
      where: { id: raw.retailerId },
      create: {
        id: raw.retailerId,
        displayName: raw.retailerId.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" "),
      },
      update: {},
    });

    const upserted = await prisma.offlineDeal.upsert({
      where: { source_sourceDealId: { source, sourceDealId: raw.sourceDealId } },
      create: {
        source,
        sourceDealId: raw.sourceDealId,
        retailerId: raw.retailerId,
        title: raw.title,
        description: raw.description ?? null,
        brand: raw.brand ?? null,
        imageUrl: raw.imageUrl ?? null,
        category: raw.category ?? null,
        priceEur: raw.priceEur ?? null,
        originalPriceEur: raw.originalPriceEur ?? null,
        validFrom: raw.validFrom,
        validUntil: raw.validUntil,
        sourceUrl: raw.sourceUrl ?? null,
        postalCode: raw.postalCode ?? null,
        storeName: raw.storeName ?? null,
        storeAddress: raw.storeAddress ?? null,
        storeCity: raw.storeCity ?? null,
        storeLat: raw.storeLat ?? null,
        storeLng: raw.storeLng ?? null,
        lastSeenAt: now,
      },
      update: {
        title: raw.title,
        description: raw.description ?? null,
        brand: raw.brand ?? null,
        imageUrl: raw.imageUrl ?? null,
        category: raw.category ?? null,
        priceEur: raw.priceEur ?? null,
        originalPriceEur: raw.originalPriceEur ?? null,
        validFrom: raw.validFrom,
        validUntil: raw.validUntil,
        sourceUrl: raw.sourceUrl ?? null,
        postalCode: raw.postalCode ?? null,
        storeName: raw.storeName ?? null,
        storeAddress: raw.storeAddress ?? null,
        storeCity: raw.storeCity ?? null,
        storeLat: raw.storeLat ?? null,
        storeLng: raw.storeLng ?? null,
        lastSeenAt: now,
      },
    });

    const dealView = mkDealView(upserted);

    if (!prior) {
      events.push({
        dealId: upserted.id,
        type: "NEW_DEAL",
        deal: dealView,
        detail: { source, sourceDealId: raw.sourceDealId },
      });
      continue;
    }

    if (
      typeof prior.priceEur === "number" &&
      typeof raw.priceEur === "number" &&
      raw.priceEur < prior.priceEur
    ) {
      events.push({
        dealId: upserted.id,
        type: "PRICE_DROP",
        deal: dealView,
        detail: { previousPrice: prior.priceEur, newPrice: raw.priceEur, source },
      });
    }

    // EXPIRING_SOON: within 48h window AND not fired in last 24h
    const hoursUntilExpiry = (upserted.validUntil.getTime() - now.getTime()) / 3_600_000;
    if (hoursUntilExpiry > 0 && hoursUntilExpiry <= EXPIRING_THRESHOLD_HOURS) {
      const recentExpiring = await prisma.offlineEvent.findFirst({
        where: {
          dealId: upserted.id,
          type: "EXPIRING_SOON",
          createdAt: { gt: new Date(Date.now() - DEDUP_EVENT_WINDOW_HOURS * 3_600_000) },
        },
      });
      if (!recentExpiring) {
        events.push({
          dealId: upserted.id,
          type: "EXPIRING_SOON",
          deal: dealView,
          detail: { hoursUntilExpiry: Math.round(hoursUntilExpiry), source },
        });
      }
    }
  }

  // 3: WENT_AWAY for deals that disappeared from this source's response
  const wentAwayCandidates = existing.filter((d) => !freshIds.has(d.sourceDealId));
  for (const gone of wentAwayCandidates) {
    // Only emit if validity hasn't already expired (no point pushing about
    // deals that ended normally) and lastSeen was recent enough that this is
    // actually a "disappeared" not a long-since-gone one.
    if (gone.validUntil < now) continue;
    const lastSeenDaysAgo = (now.getTime() - gone.lastSeenAt.getTime()) / 86_400_000;
    if (lastSeenDaysAgo > 7) continue; // probably already pushed in a previous run
    const full = await prisma.offlineDeal.findUnique({ where: { id: gone.id } });
    if (!full) continue;
    const recentWentAway = await prisma.offlineEvent.findFirst({
      where: {
        dealId: gone.id,
        type: "WENT_AWAY",
        createdAt: { gt: new Date(Date.now() - DEDUP_EVENT_WINDOW_HOURS * 3_600_000) },
      },
    });
    if (recentWentAway) continue;
    events.push({
      dealId: gone.id,
      type: "WENT_AWAY",
      deal: mkDealView(full),
      detail: { source, lastSeenAt: gone.lastSeenAt.toISOString() },
    });
  }

  // Persist all events to DB
  if (events.length > 0) {
    await prisma.offlineEvent.createMany({
      data: events.map((e) => ({
        dealId: e.dealId,
        type: e.type,
        detail: e.detail as Prisma.InputJsonValue,
      })),
    });
  }

  log.info(
    { newDeals: events.filter((e) => e.type === "NEW_DEAL").length,
      priceDrops: events.filter((e) => e.type === "PRICE_DROP").length,
      expiring: events.filter((e) => e.type === "EXPIRING_SOON").length,
      wentAway: events.filter((e) => e.type === "WENT_AWAY").length },
    "offline detect complete",
  );

  return events;
}

function mkDealView(d: {
  title: string;
  retailerId: string;
  priceEur: number | null;
  originalPriceEur: number | null;
  validFrom: Date;
  validUntil: Date;
  sourceUrl: string | null;
  imageUrl: string | null;
  postalCode: string | null;
  storeCity: string | null;
  storeName: string | null;
  storeAddress: string | null;
}): DetectedOfflineEvent["deal"] {
  return {
    title: d.title,
    retailerId: d.retailerId,
    priceEur: d.priceEur,
    originalPriceEur: d.originalPriceEur,
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    sourceUrl: d.sourceUrl,
    imageUrl: d.imageUrl,
    postalCode: d.postalCode,
    storeCity: d.storeCity,
    storeName: d.storeName,
    storeAddress: d.storeAddress,
  };
}
