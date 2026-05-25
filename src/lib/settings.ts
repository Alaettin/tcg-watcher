import { prisma } from "./prisma.js";

export const SETTING_KEYS = {
  GLOBAL_NEGATIVE_TERMS: "globalNegativeTerms",
  NTFY_CONFIG: "ntfyConfig",
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
