import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { sendNtfyRaw } from "../notify/ntfy.js";
import type { DetectedOfflineEvent, OfflineEventType } from "./detector.js";

const TITLE_PREFIX: Record<OfflineEventType, string> = {
  NEW_DEAL: "📰 NEU",
  PRICE_DROP: "📰 💰 BILLIGER",
  EXPIRING_SOON: "📰 ⏰ LÄUFT AUS",
  WENT_AWAY: "📰 ✗ WEG",
};

const PRIORITY: Record<OfflineEventType, number> = {
  NEW_DEAL: 4,
  PRICE_DROP: 4,
  EXPIRING_SOON: 3,
  WENT_AWAY: 2,
};

const TAGS: Record<OfflineEventType, string[]> = {
  NEW_DEAL: ["package", "sparkles"],
  PRICE_DROP: ["moneybag", "chart_with_downwards_trend"],
  EXPIRING_SOON: ["alarm_clock"],
  WENT_AWAY: ["x"],
};

function formatEur(value: number): string {
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

const INTER_EVENT_DELAY_MS = 150;

export async function notifyOfflineEvents(events: DetectedOfflineEvent[]): Promise<void> {
  let first = true;
  for (const ev of events) {
    if (!first) await new Promise((r) => setTimeout(r, INTER_EVENT_DELAY_MS));
    first = false;
    try {
      await notifyOne(ev);
    } catch (error) {
      logger.warn({ err: error, dealId: ev.dealId, type: ev.type }, "offline notify failed");
    }
  }
}

async function notifyOne(ev: DetectedOfflineEvent): Promise<void> {
  const retailer = await prisma.offlineRetailer.findUnique({
    where: { id: ev.deal.retailerId },
    select: { displayName: true },
  });
  const retailerName = retailer?.displayName ?? ev.deal.retailerId;

  const titleParts = [TITLE_PREFIX[ev.type], retailerName, "—", ev.deal.title];
  const title = titleParts.join(" ");

  const lines: string[] = [];
  if (typeof ev.deal.priceEur === "number") {
    lines.push(
      ev.deal.originalPriceEur && ev.deal.originalPriceEur > ev.deal.priceEur
        ? `${formatEur(ev.deal.priceEur)} (vorher ${formatEur(ev.deal.originalPriceEur)})`
        : formatEur(ev.deal.priceEur),
    );
  }
  if (ev.type === "PRICE_DROP" && typeof ev.detail.previousPrice === "number") {
    lines.push(`vorher ${formatEur(ev.detail.previousPrice as number)}`);
  }
  lines.push(`Gültig: ${formatDate(ev.deal.validFrom)} – ${formatDate(ev.deal.validUntil)}`);
  if (ev.type === "EXPIRING_SOON" && typeof ev.detail.hoursUntilExpiry === "number") {
    lines.push(`Nur noch ${ev.detail.hoursUntilExpiry}h!`);
  }
  if (ev.deal.storeAddress) {
    const locationParts = [ev.deal.storeName, ev.deal.storeCity, ev.deal.storeAddress].filter(Boolean);
    lines.push(`Filiale: ${locationParts.join(", ")}`);
  } else if (ev.deal.postalCode) {
    lines.push(`PLZ-Region: ${ev.deal.postalCode}`);
  }

  await sendNtfyRaw(
    {
      title,
      message: lines.join("\n"),
      priority: PRIORITY[ev.type],
      tags: TAGS[ev.type],
      click: ev.deal.sourceUrl ?? undefined,
    },
    "offline",
  );

  await prisma.offlineEvent.updateMany({
    where: {
      dealId: ev.dealId,
      type: ev.type,
      notifiedAt: null,
    },
    data: { notifiedAt: new Date() },
  });
}
