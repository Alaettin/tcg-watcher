import { prisma } from "./prisma.js";

export const SETTING_KEYS = {
  GLOBAL_NEGATIVE_TERMS: "globalNegativeTerms",
  NTFY_CONFIG: "ntfyConfig",
  DEFAULT_FAST_SET_LIST_ID: "defaultFastSetListId",
  DEFAULT_SLOW_SET_LIST_ID: "defaultSlowSetListId",
  // Offline / Prospekt-Tracker (marktguru et al.) — separate sub-system
  PROSPEKTE_ENABLED: "prospekteEnabled",
  PROSPEKTE_POSTAL_CODES: "prospektePostalCodes",
  PROSPEKTE_SEARCH_QUERIES: "prospekteSearchQueries",
  PROSPEKTE_NEGATIVE_TERMS: "prospekteNegativeTerms",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export interface NtfyChannel {
  id: string;
  name: string;
  topic: string;
  enabled: boolean;
}

export interface NtfyConfig {
  server: string;
  channels: NtfyChannel[];
}

export const DEFAULT_NTFY_CONFIG: NtfyConfig = {
  server: "https://ntfy.sh",
  channels: [],
};

export async function getNtfyConfig(): Promise<NtfyConfig> {
  return getSetting<NtfyConfig>(SETTING_KEYS.NTFY_CONFIG, DEFAULT_NTFY_CONFIG);
}

export interface FamilyDefaults {
  fast: string | null;
  slow: string | null;
}

export async function getFamilyDefaults(): Promise<FamilyDefaults> {
  const [fast, slow] = await Promise.all([
    getSetting<string | null>(SETTING_KEYS.DEFAULT_FAST_SET_LIST_ID, null),
    getSetting<string | null>(SETTING_KEYS.DEFAULT_SLOW_SET_LIST_ID, null),
  ]);
  return { fast, slow };
}

export interface ProspekteConfig {
  enabled: boolean;
  postalCodes: string[];           // [] = deutschlandweit (kann sein dass API dann nichts liefert; UI hinweist)
  searchQueries: string[];         // default ["pokemon"]
  negativeTerms: string[];         // default kurz: Bücher/Hörspiele
}

export const DEFAULT_PROSPEKTE_NEGATIVES = [
  "Kalender",
  "Hörspiel",
  "Roman",
  "eBook",
  "Day-To-Day",
  "Day to Day",
];

export async function getProspekteConfig(): Promise<ProspekteConfig> {
  const [enabled, postalCodes, searchQueries, negativeTerms] = await Promise.all([
    getSetting<boolean>(SETTING_KEYS.PROSPEKTE_ENABLED, true),
    getSetting<string[]>(SETTING_KEYS.PROSPEKTE_POSTAL_CODES, []),
    getSetting<string[]>(SETTING_KEYS.PROSPEKTE_SEARCH_QUERIES, ["pokemon"]),
    getSetting<string[]>(SETTING_KEYS.PROSPEKTE_NEGATIVE_TERMS, DEFAULT_PROSPEKTE_NEGATIVES),
  ]);
  return { enabled, postalCodes, searchQueries, negativeTerms };
}

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  loadedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function invalidateSettingCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value as T;
  }

  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) {
    cache.set(key, { value: defaultValue, loadedAt: Date.now() });
    return defaultValue;
  }

  try {
    const parsed = JSON.parse(row.value) as T;
    cache.set(key, { value: parsed, loadedAt: Date.now() });
    return parsed;
  } catch {
    cache.set(key, { value: defaultValue, loadedAt: Date.now() });
    return defaultValue;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: serialized },
    update: { value: serialized },
  });
  invalidateSettingCache(key);
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany();
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}
