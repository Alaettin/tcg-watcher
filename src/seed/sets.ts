import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const VariantSeedSchema = z.object({
  kind: z.string().min(1).max(40),
  displayName: z.string().min(1).max(200),
  uvpEur: z.number().nullable().optional(),
  uvpToleranceEur: z.number().optional(),
  ean: z.string().nullable().optional(),
});

const SetSeedSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  shortCode: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  language: z.string().default("DE"),
  era: z.string().nullable().optional(),
  searchTerms: z.array(z.string()).min(1),
  negativeTerms: z.array(z.string()).default([]),
  variants: z.array(VariantSeedSchema).default([]),
});

const SetPresetsSchema = z.array(SetSeedSchema);

export type SetSeed = z.infer<typeof SetSeedSchema>;

export async function loadSetPresets(): Promise<SetSeed[]> {
  const path = resolve(process.cwd(), "config/set-presets.json");
  const raw = await readFile(path, "utf-8");
  return SetPresetsSchema.parse(JSON.parse(raw));
}

export async function seedSetPresets(): Promise<{ added: number; skipped: number }> {
  const presets = await loadSetPresets();
  let added = 0;
  let skipped = 0;

  for (const preset of presets) {
    const existing = await prisma.set.findUnique({ where: { id: preset.id } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.set.create({
      data: {
        id: preset.id,
        name: preset.name,
        shortCode: preset.shortCode ?? null,
        description: preset.description ?? null,
        releaseDate: preset.releaseDate ? new Date(preset.releaseDate) : null,
        language: preset.language,
        era: preset.era ?? null,
        searchTerms: preset.searchTerms,
        negativeTerms: preset.negativeTerms,
        active: false,
        isPreset: true,
        variants: {
          create: preset.variants.map((v) => ({
            kind: v.kind,
            displayName: v.displayName,
            uvpEur: v.uvpEur ?? null,
            uvpToleranceEur: v.uvpToleranceEur ?? 10,
            ean: v.ean ?? null,
          })),
        },
      },
    });
    added++;
  }

  logger.info({ added, skipped, total: presets.length }, "set presets seeded");
  return { added, skipped };
}
