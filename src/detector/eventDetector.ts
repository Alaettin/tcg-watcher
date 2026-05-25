import { EventType, ListingStatus, type Listing, type Set as SetRow, type Variant } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { SetMatchResult } from "../matcher/setMatcher.js";

export interface DetectedEvent {
  type: EventType;
  setId: string;
  setName: string;
  variantId: string | null;
  variantKind: string | null;
  shopId: string;
  externalId: string;
  url: string;
  title: string;
  priceEur: number;
  detail: Record<string, unknown>;
}

const PRICE_DROP_PCT = 0.05;
const DEDUP_WINDOW_HOURS = 6;

function withinUvp(variant: Variant | null, priceEur: number): boolean {
  if (!variant || variant.uvpEur == null) return true;
  return priceEur <= variant.uvpEur + variant.uvpToleranceEur;
}

function statusFromAvailability(raw: string): ListingStatus {
  switch (raw) {
    case "IN_STOCK":
      return ListingStatus.IN_STOCK;
    case "OUT_OF_STOCK":
      return ListingStatus.OUT_OF_STOCK;
    case "PREORDER":
      return ListingStatus.PREORDER;
    default:
      return ListingStatus.UNKNOWN;
  }
}

async function recentEventExists(listingId: string, type: EventType): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3600_000);
  const found = await prisma.event.findFirst({
    where: { listingId, type, createdAt: { gt: cutoff } },
    select: { id: true },
  });
  return !!found;
}

export async function detectAndPersist(
  shopId: string,
  matches: SetMatchResult[],
): Promise<DetectedEvent[]> {
  const events: DetectedEvent[] = [];
  const setCache = new Map<string, SetRow>();
  const variantCache = new Map<string, Variant>();

  for (const match of matches) {
    const status = statusFromAvailability(match.listing.status);

    const set =
      setCache.get(match.setId)
      ?? (await prisma.set.findUnique({ where: { id: match.setId } }));
    if (!set) continue;
    setCache.set(set.id, set);

    let variant: Variant | null = null;
    if (match.variantId) {
      variant =
        variantCache.get(match.variantId)
        ?? (await prisma.variant.findUnique({ where: { id: match.variantId } }));
      if (variant) variantCache.set(variant.id, variant);
    }

    const previous: Listing | null = await prisma.listing.findUnique({
      where: { shopId_externalId: { shopId, externalId: match.listing.externalId } },
    });

    const listing = await prisma.listing.upsert({
      where: { shopId_externalId: { shopId, externalId: match.listing.externalId } },
      create: {
        setId: set.id,
        variantId: variant?.id ?? null,
        shopId,
        externalId: match.listing.externalId,
        url: match.listing.url,
        title: match.listing.title,
        priceEur: match.listing.priceEur,
        status,
        seenAt: new Date(),
      },
      update: {
        setId: set.id,
        variantId: variant?.id ?? null,
        url: match.listing.url,
        title: match.listing.title,
        priceEur: match.listing.priceEur,
        status,
        seenAt: new Date(),
      },
    });

    const detected: Omit<DetectedEvent, "setId" | "setName" | "variantId" | "variantKind">[] = [];

    if (!previous) {
      detected.push({
        type: EventType.NEW_LISTING,
        shopId,
        externalId: listing.externalId,
        url: listing.url,
        title: listing.title,
        priceEur: listing.priceEur,
        detail: {
          confidence: match.confidence,
          status,
          withinUvp: withinUvp(variant, listing.priceEur),
        },
      });
    } else {
      const wasOut = previous.status === ListingStatus.OUT_OF_STOCK || previous.status === ListingStatus.UNKNOWN;
      const isInStock = status === ListingStatus.IN_STOCK || status === ListingStatus.PREORDER;
      if (wasOut && isInStock) {
        detected.push({
          type: EventType.RESTOCK,
          shopId,
          externalId: listing.externalId,
          url: listing.url,
          title: listing.title,
          priceEur: listing.priceEur,
          detail: {
            previousStatus: previous.status,
            newStatus: status,
            withinUvp: withinUvp(variant, listing.priceEur),
          },
        });
      }
      if (previous.priceEur > 0 && listing.priceEur > 0) {
        const dropPct = (previous.priceEur - listing.priceEur) / previous.priceEur;
        if (dropPct >= PRICE_DROP_PCT) {
          detected.push({
            type: EventType.PRICE_DROP,
            shopId,
            externalId: listing.externalId,
            url: listing.url,
            title: listing.title,
            priceEur: listing.priceEur,
            detail: {
              previousPrice: previous.priceEur,
              newPrice: listing.priceEur,
              dropPct: Number(dropPct.toFixed(4)),
            },
          });
        }
      }
      if (previous.status !== ListingStatus.OUT_OF_STOCK && status === ListingStatus.OUT_OF_STOCK) {
        detected.push({
          type: EventType.WENT_OUT_OF_STOCK,
          shopId,
          externalId: listing.externalId,
          url: listing.url,
          title: listing.title,
          priceEur: listing.priceEur,
          detail: { previousStatus: previous.status },
        });
      }
    }

    for (const partial of detected) {
      if (await recentEventExists(listing.id, partial.type)) continue;
      await prisma.event.create({
        data: {
          listingId: listing.id,
          type: partial.type,
          detail: partial.detail as object,
        },
      });
      events.push({
        ...partial,
        setId: set.id,
        setName: set.name,
        variantId: variant?.id ?? null,
        variantKind: variant?.kind ?? match.variantKind ?? null,
      });
    }
  }

  return events;
}
