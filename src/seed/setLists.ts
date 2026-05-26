import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { setSetting, getFamilyDefaults, SETTING_KEYS } from "../lib/settings.js";

const DEFAULT_FAST_NAME = "Default Fast";
const DEFAULT_SLOW_NAME = "Default Slow — aktuelle";

// Sets considered "current" and worth tracking on broad-catalog Playwright
// shops (mediamarkt, thalia, galaxus, etc.). Older sets are usually
// long-sold-out at these retailers, so searching them just burns time.
const SLOW_DEFAULT_SET_IDS = [
  "kp08-funkenmeer",
  "kp85-prismatische-entwicklungen",
  "kp09-reisegefaehrten",
  "kp95-ewige-rivalen",
  "kp10-black-bolt-white-flare",
  "kp105-mega-evolution-wachsendes-chaos",
  "kp11-mega-evolution-optimale-ordnung",
  "30th-anniversary",
];

async function ensureSystemList(
  name: string,
  description: string,
  setIds: string[],
): Promise<string> {
  const existing = await prisma.setList.findUnique({ where: { name } });
  if (existing) return existing.id;

  const created = await prisma.setList.create({
    data: {
      name,
      description,
      isSystem: true,
      items: { create: setIds.map((setId) => ({ setId })) },
    },
  });
  logger.info({ name, items: setIds.length }, "system set-list seeded");
  return created.id;
}

export async function seedSetLists(): Promise<void> {
  const allSets = await prisma.set.findMany({ select: { id: true } });
  const allSetIds = allSets.map((s) => s.id);
  if (allSetIds.length === 0) {
    logger.warn("no sets in DB yet — skipping set-list seed");
    return;
  }

  const fastListId = await ensureSystemList(
    DEFAULT_FAST_NAME,
    "Wird automatisch auf alle Sets gesetzt. Standard für HTTP-Shops (Shopify/JTL/Shopware/Otto/ideeundspiel) — die haben gezielte Such-APIs, deshalb sind viele Set-Begriffe günstig.",
    allSetIds,
  );

  // Only include slow defaults that actually exist in DB (resilient to seed
  // changes or partial set lists).
  const existingSlowSetIds = SLOW_DEFAULT_SET_IDS.filter((id) => allSetIds.includes(id));
  const slowListId = await ensureSystemList(
    DEFAULT_SLOW_NAME,
    "Wird automatisch auf die aktuellen Sets gesetzt. Standard für Playwright-Shops (mediamarkt/thalia/galaxus/…) — die haben Broad-Catalog-Suche, jede Set-Suche kostet 10-15s Chromium-Zeit.",
    existingSlowSetIds,
  );

  // Wire up the family defaults if they're not set yet. We do NOT overwrite
  // existing user-chosen defaults.
  const current = await getFamilyDefaults();
  if (!current.fast) {
    await setSetting(SETTING_KEYS.DEFAULT_FAST_SET_LIST_ID, fastListId);
    logger.info({ listId: fastListId }, "defaultFastSetListId set");
  }
  if (!current.slow) {
    await setSetting(SETTING_KEYS.DEFAULT_SLOW_SET_LIST_ID, slowListId);
    logger.info({ listId: slowListId }, "defaultSlowSetListId set");
  }
}
