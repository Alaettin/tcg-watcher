import { EventType } from "@prisma/client";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import type { DetectedEvent } from "../detector/eventDetector.js";
import { sendNtfy } from "./ntfy.js";
import { eventBus } from "../web/eventBus.js";

const ICONS: Record<EventType, string> = {
  NEW_LISTING: "[NEW]",
  RESTOCK: "[RESTOCK]",
  PRICE_DROP: "[PRICE]",
  RESALE_DEAL: "[RESALE]",
  WENT_OUT_OF_STOCK: "[OOS]",
};

function formatEur(value: number): string {
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export async function notify(event: DetectedEvent): Promise<void> {
  const icon = ICONS[event.type] ?? "[EVENT]";
  const setLabel = event.variantKind
    ? `${event.setName} (${event.variantKind})`
    : event.setName;
  const line = `${icon} ${setLabel} | ${event.title} | ${formatEur(event.priceEur)} | shop=${event.shopId} | ${event.url}`;

  logger.info(
    {
      event: event.type,
      setId: event.setId,
      setName: event.setName,
      variantKind: event.variantKind,
      shopId: event.shopId,
      priceEur: event.priceEur,
      url: event.url,
      detail: event.detail,
    },
    line,
  );

  await sendNtfy(event);

  eventBus.emitDetected(event);

  await prisma.event.updateMany({
    where: {
      listing: { shopId: event.shopId, externalId: event.externalId },
      type: event.type,
      notifiedAt: null,
    },
    data: { notifiedAt: new Date() },
  });
}

// Small gap between events so a single shop-run with many matches doesn't
// burst-fire dozens of requests at ntfy.sh (the public instance rate-limits
// around 60 req/min per IP and starts returning 502 under sudden load).
const INTER_EVENT_DELAY_MS = 150;

export async function notifyAll(events: DetectedEvent[]): Promise<void> {
  let first = true;
  for (const event of events) {
    if (!first) await new Promise((r) => setTimeout(r, INTER_EVENT_DELAY_MS));
    first = false;
    await notify(event);
  }
}
