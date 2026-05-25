import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { SETTING_KEYS } from "../lib/settings.js";
import { DEFAULT_GLOBAL_NEGATIVE_TERMS } from "../matcher/productMatcher.js";

export async function seedSettings(): Promise<void> {
  const existing = await prisma.setting.findUnique({
    where: { key: SETTING_KEYS.GLOBAL_NEGATIVE_TERMS },
  });
  if (existing) return;

  await prisma.setting.create({
    data: {
      key: SETTING_KEYS.GLOBAL_NEGATIVE_TERMS,
      value: JSON.stringify(DEFAULT_GLOBAL_NEGATIVE_TERMS),
    },
  });
  logger.info(
    { key: SETTING_KEYS.GLOBAL_NEGATIVE_TERMS, count: DEFAULT_GLOBAL_NEGATIVE_TERMS.length },
    "default settings seeded",
  );
}
