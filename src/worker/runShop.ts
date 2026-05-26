import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { createAdapterForShop } from "../adapters/registry.js";
import { getActiveSets, matchListingsToSets } from "../matcher/setMatcher.js";
import { detectAndPersist } from "../detector/eventDetector.js";
import { notifyAll } from "../notify/sink.js";

export interface RunShopResult {
  shopId: string;
  listingsFound: number;
  matched: number;
  events: number;
  boostWorthyEvents: number;
  durationMs: number;
}

function emptyResult(shopId: string, durationMs = 0): RunShopResult {
  return {
    shopId,
    listingsFound: 0,
    matched: 0,
    events: 0,
    boostWorthyEvents: 0,
    durationMs,
  };
}

export async function runShop(shopId: string): Promise<RunShopResult> {
  const start = Date.now();
  const log = logger.child({ shopId });

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) {
    throw new Error(`shop ${shopId} not found`);
  }
  if (!shop.enabled) {
    log.warn("shop disabled, skipping");
    return emptyResult(shopId);
  }

  const adapter = createAdapterForShop(shop);
  if (!adapter) {
    log.warn({ adapterType: shop.adapterType }, "no adapter implementation for adapterType");
    return emptyResult(shopId);
  }

  const activeSets = await getActiveSets();
  if (activeSets.length === 0) {
    log.warn("no active sets — nothing to search for");
    await prisma.shop.update({
      where: { id: shopId },
      data: { lastSuccessfulRun: new Date() },
    });
    return emptyResult(shopId, Date.now() - start);
  }

  const allSearchTerms = [...new Set(activeSets.flatMap((s) => s.searchTerms))];
  const allNegatives = [...new Set(activeSets.flatMap((s) => s.negativeTerms))];

  let listings;
  try {
    listings = await adapter.search(allSearchTerms, allNegatives);
  } catch (error) {
    log.error({ err: error }, "adapter search failed");
    return emptyResult(shopId, Date.now() - start);
  }

  // Wrap the post-search pipeline in try/catch so that a transient DB or
  // ntfy hiccup doesn't fail the whole BullMQ job (which would skip the
  // next scheduled tick) — we'd rather log and let the repeatable retry.
  try {
    const matches = await matchListingsToSets(listings);
    const events = await detectAndPersist(shopId, matches);
    await notifyAll(events);

    const newListings = events.filter((e) => e.type === "NEW_LISTING").length;
    const restocks = events.filter((e) => e.type === "RESTOCK").length;
    const boostWorthyEvents = newListings + restocks;
    const durationMs = Date.now() - start;
    const completedAt = new Date();

    await prisma.shop.update({
      where: { id: shopId },
      data: {
        lastSuccessfulRun: completedAt,
        lastRunStats: {
          completedAt: completedAt.toISOString(),
          durationMs,
          listingsFound: listings.length,
          matched: matches.length,
          events: events.length,
          newListings,
          restocks,
        },
      },
    });

    const result: RunShopResult = {
      shopId,
      listingsFound: listings.length,
      matched: matches.length,
      events: events.length,
      boostWorthyEvents,
      durationMs,
    };

    log.info(result, "shop run complete");
    return result;
  } catch (error) {
    log.error(
      { err: error, listingsFound: listings.length },
      "post-search pipeline failed (match/detect/persist/notify)",
    );
    return emptyResult(shopId, Date.now() - start);
  }
}
