import axios from "axios";
import { EventType } from "@prisma/client";
import { logger } from "../lib/logger.js";
import { getNtfyConfig, type NtfyChannel, type NtfyConfig } from "../lib/settings.js";
import type { DetectedEvent } from "../detector/eventDetector.js";

const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;

const TITLES: Record<EventType, string> = {
  NEW_LISTING: "Neues Listing",
  RESTOCK: "RESTOCK",
  PRICE_DROP: "Preisdrop",
  RESALE_DEAL: "Resale-Deal",
  WENT_OUT_OF_STOCK: "Ausverkauft",
};

const PRIORITY: Record<EventType, number> = {
  NEW_LISTING: 5,
  RESTOCK: 5,
  PRICE_DROP: 4,
  RESALE_DEAL: 4,
  WENT_OUT_OF_STOCK: 2,
};

const TAGS: Record<EventType, string> = {
  NEW_LISTING: "package,sparkles",
  RESTOCK: "package,white_check_mark",
  PRICE_DROP: "moneybag,chart_with_downwards_trend",
  RESALE_DEAL: "handshake",
  WENT_OUT_OF_STOCK: "no_entry",
};

function formatEur(value: number): string {
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function activeChannels(cfg: NtfyConfig): NtfyChannel[] {
  return cfg.channels.filter((c) => c.enabled && c.topic.trim().length > 0);
}

export async function ntfyEnabled(): Promise<boolean> {
  const cfg = await getNtfyConfig();
  return activeChannels(cfg).length > 0;
}

interface RawPushPayload {
  title: string;
  message: string;
  priority: number;
  tags: string[];
  click?: string;
  actions?: Array<{ action: string; label: string; url: string; clear?: boolean }>;
}

async function postToChannel(
  server: string,
  channel: NtfyChannel,
  payload: RawPushPayload,
): Promise<void> {
  const trimmedServer = server.replace(/\/+$/, "");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await axios.post(
        trimmedServer,
        { topic: channel.topic, ...payload },
        { timeout: TIMEOUT_MS, headers: { "Content-Type": "application/json" } },
      );
      return;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status ?? 0;
      const retriable = !status || status >= 500 || status === 429;
      if (!retriable || attempt === MAX_ATTEMPTS - 1) {
        logger.warn(
          { err: error, channelName: channel.name, channelTopic: channel.topic, status, attempts: attempt + 1 },
          "ntfy channel push failed (giving up)",
        );
        return;
      }
      const delay = 500 * Math.pow(2, attempt); // 500ms → 1000ms
      logger.warn(
        { channelName: channel.name, status, attempt: attempt + 1, delayMs: delay },
        "ntfy push retry after server error",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function sendNtfyRaw(payload: RawPushPayload): Promise<void> {
  const cfg = await getNtfyConfig();
  const channels = activeChannels(cfg);
  if (channels.length === 0) return;
  await Promise.allSettled(channels.map((c) => postToChannel(cfg.server, c, payload)));
}

export async function sendNtfy(event: DetectedEvent): Promise<void> {
  const lines = [event.title, formatEur(event.priceEur)];
  const confidence = (event.detail as { confidence?: number }).confidence;
  if (typeof confidence === "number") {
    lines.push(`Match ${Math.round(confidence * 100)}%`);
  }
  const previousPrice = (event.detail as { previousPrice?: number }).previousPrice;
  if (typeof previousPrice === "number") {
    lines.push(`vorher ${formatEur(previousPrice)}`);
  }

  const setLabel = event.variantKind
    ? `${event.setName} (${event.variantKind})`
    : event.setName;

  await sendNtfyRaw({
    title: `${TITLES[event.type]} — ${setLabel} @ ${event.shopId}`,
    message: lines.join("\n"),
    priority: PRIORITY[event.type],
    tags: TAGS[event.type].split(","),
    click: event.url,
    actions: [
      {
        action: "view",
        label: "Zum Shop",
        url: event.url,
        clear: true,
      },
    ],
  });
}

export async function sendTestPush(server: string, topic: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await axios.post(
      server.replace(/\/+$/, ""),
      {
        topic,
        title: "Pokemon Watcher — Test",
        message: "Wenn du das siehst, funktioniert dieser Channel.",
        priority: 4,
        tags: ["white_check_mark", "test_tube"],
      },
      { timeout: TIMEOUT_MS, headers: { "Content-Type": "application/json" } },
    );
    return { ok: true };
  } catch (error) {
    const msg =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message)
        : "unknown error";
    return { ok: false, error: msg };
  }
}
