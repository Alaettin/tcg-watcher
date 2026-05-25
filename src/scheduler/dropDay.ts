import type { Shop } from "@prisma/client";

interface DropWindow {
  date: string;
  start: string;
  end: string;
  label: string;
}

export const DROP_DAYS: DropWindow[] = [
  { date: "2026-06-19", start: "08:00", end: "20:00", label: "First Partner S2" },
  { date: "2026-09-16", start: "00:01", end: "23:59", label: "30th Celebration" },
  { date: "2026-10-16", start: "00:01", end: "23:59", label: "Card Sets" },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function todayIsoDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function clockHHMM(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function currentDropWindow(now: Date = new Date()): DropWindow | null {
  const date = todayIsoDate(now);
  const time = clockHHMM(now);
  return DROP_DAYS.find((w) => w.date === date && time >= w.start && time <= w.end) ?? null;
}

let boostUntil = 0;

export function triggerCascadeBoost(durationMs = 10 * 60_000): void {
  boostUntil = Math.max(boostUntil, Date.now() + durationMs);
}

export function isBoostActive(): boolean {
  return Date.now() < boostUntil;
}

export function boostRemainingSeconds(): number {
  return Math.max(0, Math.ceil((boostUntil - Date.now()) / 1000));
}

// Min poll interval enforced per adapter type, regardless of what's stored in the Shop row.
// Calibrated to real-world run durations (search across ~30 watchlist terms) plus headroom,
// so the scheduler never queues faster than the adapter can finish.
const ADAPTER_MIN_INTERVAL_S: Record<string, number> = {
  shopify: 60,      // ~21s/run
  shopware: 90,     // ~39s/run
  jtl: 90,          // ~42s/run
  otto: 120,        // ~52s/run
  oxid: 600,        // ~340s/run — single-match-redirect + Cloudflare slows this down massively
  wix: 360,         // ~224s/run (Playwright)
  galaxus: 360,     // ~226s/run (Playwright)
  mediamarkt: 360,  // ~245s/run (Playwright)
  thalia: 360,      // ~267s/run (Playwright)
  smyths: 360,
  alternate: 90,    // single category-page, fast Playwright (~15-25s)
  toysforfun: 90,   // single brand-page, fast Playwright (~15-25s)
  ideeundspiel: 90, // single category-page HTTP, fast (~3-5s)
  playwright: 360,
};

const DEFAULT_MIN_INTERVAL_S = 60;

function minIntervalSeconds(shop: Shop): number {
  return ADAPTER_MIN_INTERVAL_S[shop.adapterType] ?? DEFAULT_MIN_INTERVAL_S;
}

export function getCurrentIntervalSeconds(shop: Shop): number {
  const base = currentDropWindow() || isBoostActive()
    ? shop.dropDayIntervalSeconds
    : shop.pollIntervalSeconds;
  return Math.max(base, minIntervalSeconds(shop));
}
