import { Router } from "express";
import { z } from "zod";
import {
  DEFAULT_NTFY_CONFIG,
  SETTING_KEYS,
  getAllSettings,
  getNtfyConfig,
  getSetting,
  setSetting,
  invalidateSettingCache,
} from "../../lib/settings.js";
import { prisma } from "../../lib/prisma.js";
import { DEFAULT_GLOBAL_NEGATIVE_TERMS } from "../../matcher/productMatcher.js";
import { invalidateSetsForShopCache } from "../../matcher/setMatcher.js";
import { sendTestPush } from "../../notify/ntfy.js";

export const settingsRouter = Router();

const NtfyChannelSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  topic: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-zA-Z0-9_-]+$/, "only letters/digits/_/-"),
  enabled: z.boolean(),
});

const NtfyConfigSchema = z.object({
  server: z.string().url(),
  channels: z.array(NtfyChannelSchema).max(10),
});

const VALIDATORS: Record<string, z.ZodTypeAny> = {
  [SETTING_KEYS.GLOBAL_NEGATIVE_TERMS]: z.array(z.string().min(1).max(120)).max(500),
  [SETTING_KEYS.NTFY_CONFIG]: NtfyConfigSchema,
  [SETTING_KEYS.DEFAULT_FAST_SET_LIST_ID]: z.string().nullable(),
  [SETTING_KEYS.DEFAULT_SLOW_SET_LIST_ID]: z.string().nullable(),
  [SETTING_KEYS.PROSPEKTE_ENABLED]: z.boolean(),
  [SETTING_KEYS.PROSPEKTE_POSTAL_CODES]: z.array(z.string().regex(/^\d{5}$/, "5-digit PLZ")).max(20),
  [SETTING_KEYS.PROSPEKTE_SEARCH_QUERIES]: z.array(z.string().min(1).max(60)).min(1).max(10),
  [SETTING_KEYS.PROSPEKTE_NEGATIVE_TERMS]: z.array(z.string().min(1).max(60)).max(50),
};

const SET_RESOLUTION_KEYS = new Set<string>([
  SETTING_KEYS.DEFAULT_FAST_SET_LIST_ID,
  SETTING_KEYS.DEFAULT_SLOW_SET_LIST_ID,
]);

settingsRouter.get("/settings", async (_req, res, next) => {
  try {
    const all = await getAllSettings();
    if (!(SETTING_KEYS.GLOBAL_NEGATIVE_TERMS in all)) {
      all[SETTING_KEYS.GLOBAL_NEGATIVE_TERMS] = await getSetting<string[]>(
        SETTING_KEYS.GLOBAL_NEGATIVE_TERMS,
        DEFAULT_GLOBAL_NEGATIVE_TERMS,
      );
    }
    if (!(SETTING_KEYS.NTFY_CONFIG in all)) {
      all[SETTING_KEYS.NTFY_CONFIG] = DEFAULT_NTFY_CONFIG;
    }
    res.json(all);
  } catch (err) {
    next(err);
  }
});

// Whitelist of keys that can be DELETEd (= reset to in-code default).
// We don't want a stray DELETE to nuke ntfyConfig and silently disable pushes.
const RESETTABLE_KEYS = new Set<string>([SETTING_KEYS.GLOBAL_NEGATIVE_TERMS]);

settingsRouter.delete("/settings/:key", async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!RESETTABLE_KEYS.has(key)) {
      res.status(400).json({ error: `key ${key} is not resettable via DELETE` });
      return;
    }
    await prisma.setting.deleteMany({ where: { key } });
    invalidateSettingCache(key);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

settingsRouter.put("/settings/:key", async (req, res, next) => {
  try {
    const key = req.params.key;
    const validator = VALIDATORS[key];
    if (!validator) {
      res.status(400).json({ error: `unknown setting key: ${key}` });
      return;
    }
    const parsed = validator.safeParse(req.body?.value);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid value", issues: parsed.error.issues });
      return;
    }
    await setSetting(key, parsed.data);
    // Family-default changes affect what every shop's matcher sees, so flush
    // the per-shop cache immediately rather than waiting for the 60s TTL.
    if (SET_RESOLUTION_KEYS.has(key)) {
      invalidateSetsForShopCache();
    }
    res.json({ key, value: parsed.data });
  } catch (err) {
    next(err);
  }
});

const TestPushSchema = z.object({
  topic: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-zA-Z0-9_-]+$/, "only letters/digits/_/-"),
});

settingsRouter.post("/settings/ntfyConfig/test", async (req, res, next) => {
  try {
    const parsed = TestPushSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid topic" });
      return;
    }
    const cfg = await getNtfyConfig();
    const result = await sendTestPush(cfg.server, parsed.data.topic);
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    next(err);
  }
});
