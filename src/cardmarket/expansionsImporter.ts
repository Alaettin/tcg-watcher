import { readFile, stat } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { EXPANSIONS_PATH } from "./storage.js";

// CM's expansions_6.json hat in der Praxis folgende Struktur (CM-public catalog):
//   { version: 1, createdAt: "...", expansion: [ { idExpansion, enName, abbreviation,
//     releaseDate, isReleased, idGame, idCategory, ... } ] }
// Wir sind defensiv: nur idExpansion + enName/name werden gebraucht; alles
// andere ist optional.
interface RawExpansion {
  idExpansion: number;
  // CM nutzt mal enName, mal name. Beide unterstützen.
  enName?: string | null;
  name?: string | null;
  abbreviation?: string | null;
  releaseDate?: string | null;
  idCategory?: number | null;
  idGame?: number | null;
}

interface ExpansionsFile {
  version?: number;
  createdAt?: string;
  expansion?: RawExpansion[];
  expansions?: RawExpansion[]; // Fallback falls CM die Top-Level-Key ändert
}

const CHUNK_SIZE = 200;

/** Sprach-Heuristik aus dem Set-Namen. */
const LANGUAGE_PATTERNS: { pattern: RegExp; language: string }[] = [
  { pattern: /\(JP\)|Japanese/i, language: "JP" },
  { pattern: /\(KR\)|Korean/i, language: "KR" },
  { pattern: /\(DE\)|German/i, language: "DE" },
  { pattern: /\(FR\)|French/i, language: "FR" },
  { pattern: /\(IT\)|Italian/i, language: "IT" },
  { pattern: /\(ES\)|Spanish/i, language: "ES" },
  { pattern: /\(PT\)|Portuguese/i, language: "PT" },
  { pattern: /\(ZH\)|\(CN\)|Chinese/i, language: "ZH" },
];

function detectLanguage(name: string): string {
  for (const { pattern, language } of LANGUAGE_PATTERNS) {
    if (pattern.test(name)) return language;
  }
  // Default: EN (CM listet englische Sets ohne Suffix als Canonical).
  return "EN";
}

function toDateOrNull(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface ExpansionImportResult {
  count: number;
  fromFile: boolean;
}

/**
 * Wenn `expansions_6.json` im Cardmarket-Data-Dir liegt, parsen + upserten.
 * Sonst: Fallback — Set-IDs aus CardmarketProduct ziehen und mit Platzhalter-
 * Namen `"Set {id}"` befüllen, damit Reasoning-Lines wenigstens etwas zeigen.
 */
export async function importExpansions(): Promise<ExpansionImportResult> {
  const log = logger.child({ scope: "cm-import-expansions" });

  let fileExists = false;
  try {
    await stat(EXPANSIONS_PATH);
    fileExists = true;
  } catch {
    fileExists = false;
  }

  if (!fileExists) {
    log.warn(
      { path: EXPANSIONS_PATH },
      "expansions_6.json fehlt — fallback: Bootstrap aus CardmarketProduct.idExpansion",
    );
    return await bootstrapFromProducts();
  }

  const raw = await readFile(EXPANSIONS_PATH, "utf8");
  const parsed = JSON.parse(raw) as ExpansionsFile;
  const all = parsed.expansion ?? parsed.expansions ?? [];

  log.info({ count: all.length }, "expansions file parsed");

  let written = 0;
  for (const batch of chunk(all, CHUNK_SIZE)) {
    const valid = batch
      .filter((e) => Number.isInteger(e.idExpansion))
      .map((e) => {
        const name = (e.enName ?? e.name ?? `Set ${e.idExpansion}`).trim();
        const language = detectLanguage(name);
        return { e, name, language };
      });

    if (valid.length === 0) continue;

    const now = new Date();
    const values = valid.map(({ e, name, language }) => {
      return Prisma.sql`(${e.idExpansion}, ${name}, ${language}, ${toDateOrNull(e.releaseDate ?? null)}, ${null}, ${now}, ${now})`;
    });

    await prisma.$executeRaw`
      INSERT INTO "CardmarketExpansion"
        ("idExpansion","name","language","releaseDate","parentExpansionId","importedAt","updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("idExpansion") DO UPDATE SET
        "name" = EXCLUDED."name",
        "language" = EXCLUDED."language",
        "releaseDate" = EXCLUDED."releaseDate",
        "updatedAt" = EXCLUDED."updatedAt"
    `;
    written += valid.length;
  }

  log.info({ written }, "expansions upserted");
  return { count: written, fromFile: true };
}

async function bootstrapFromProducts(): Promise<ExpansionImportResult> {
  const log = logger.child({ scope: "cm-expansions-bootstrap" });
  // Nur Sets eintragen, die wir noch nicht kennen — sonst überschreiben wir
  // potentiell sinnvollere Daten aus einem vorherigen Import.
  const distinct = await prisma.$queryRaw<{ idExpansion: number }[]>`
    SELECT DISTINCT p."idExpansion"
    FROM "CardmarketProduct" p
    LEFT JOIN "CardmarketExpansion" e ON e."idExpansion" = p."idExpansion"
    WHERE p."idExpansion" > 0
      AND e."idExpansion" IS NULL
  `;

  if (distinct.length === 0) return { count: 0, fromFile: false };

  const now = new Date();
  const values = distinct.map((r) => {
    return Prisma.sql`(${r.idExpansion}, ${`Set ${r.idExpansion}`}, ${"EN"}, ${null}, ${null}, ${now}, ${now})`;
  });
  await prisma.$executeRaw`
    INSERT INTO "CardmarketExpansion"
      ("idExpansion","name","language","releaseDate","parentExpansionId","importedAt","updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("idExpansion") DO NOTHING
  `;
  log.info({ written: distinct.length }, "expansions bootstrapped from products");
  return { count: distinct.length, fromFile: false };
}
