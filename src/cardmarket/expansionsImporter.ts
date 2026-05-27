import { readFile, stat } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { EXPANSIONS_PATH } from "./storage.js";
import { scrapeExpansions } from "./expansionsScraper.js";

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
  { pattern: /\(JP\)|Japanese|Japan(?!ische)/i, language: "JP" },
  { pattern: /\(KR\)|Korean/i, language: "KR" },
  { pattern: /\(DE\)|German|Deutsch/i, language: "DE" },
  { pattern: /\(FR\)|French|Französ/i, language: "FR" },
  { pattern: /\(IT\)|Italian|Italien/i, language: "IT" },
  { pattern: /\(ES\)|Spanish|Spanisch/i, language: "ES" },
  { pattern: /\(PT\)|Portuguese|Portugies/i, language: "PT" },
  { pattern: /\(ZH\)|\(CN\)|Chinese|Chines/i, language: "ZH" },
];

export function detectLanguage(name: string): string {
  for (const { pattern, language } of LANGUAGE_PATTERNS) {
    if (pattern.test(name)) return language;
  }
  // Default: EN (CM listet englische Sets ohne Suffix als Canonical).
  return "EN";
}

/**
 * Set-Name auf Vergleichs-Form normalisieren: Sprach-Suffix abschneiden,
 * Whitespace + Sonderzeichen entfernen, lowercase. Damit findet das
 * Parent-Mapping „151 (JP)" und „151" als denselben Basis-Set.
 */
export function normalizeSetName(name: string): string {
  return name
    .replace(/\(JP\)|\(KR\)|\(DE\)|\(FR\)|\(IT\)|\(ES\)|\(PT\)|\(ZH\)|\(CN\)/gi, "")
    .replace(/\b(Japanese|Korean|German|Deutsch|French|Französ\w*|Italian|Italien\w*|Spanish|Spanisch|Portuguese|Portugies\w*|Chinese|Chines\w*)\b/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase()
    .trim();
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
  /** "file" = expansions_6.json, "scrape" = CM-Web-Scraper, "bootstrap" = ID-only-Fallback */
  source: "file" | "scrape" | "bootstrap";
  /** Wie viele Parent-Links nach dem Import gesetzt werden konnten. */
  parentsLinked?: number;
}

/**
 * Importiert Cardmarket-Expansions in folgender Reihenfolge:
 *   1. expansions_6.json (falls vorhanden)
 *   2. Cheerio-Scraper auf cardmarket.com (Phase 4 — Web-basiert, keine JSON nötig)
 *   3. Bootstrap-Fallback: nur idExpansion aus CardmarketProduct, Namen als "Set {id}"
 * Nach erfolgreichem Import (außer Bootstrap) wird parentExpansionId gesetzt.
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

  if (fileExists) {
    const result = await importFromFile();
    const parentsLinked = await linkParentExpansions();
    return { ...result, parentsLinked };
  }

  // expansions_6.json fehlt → Scraper versuchen.
  log.info("expansions_6.json fehlt — versuche CM-Web-Scraper");
  const scraped = await scrapeExpansions();
  if (scraped.length > 0) {
    const written = await upsertScrapedExpansions(scraped);
    log.info({ written }, "expansions from scrape upserted");
    const parentsLinked = await linkParentExpansions();
    return { count: written, source: "scrape", parentsLinked };
  }

  // Letzter Fallback: Bootstrap aus den vorhandenen Produkt-Set-IDs.
  log.warn("scraper lieferte zu wenig — fallback: Bootstrap aus CardmarketProduct.idExpansion");
  const boot = await bootstrapFromProducts();
  return { ...boot, source: "bootstrap" };
}

async function importFromFile(): Promise<{ count: number; source: "file" }> {
  const log = logger.child({ scope: "cm-import-expansions-file" });
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
  log.info({ written }, "expansions upserted from file");
  return { count: written, source: "file" };
}

/**
 * Public Convenience: einmaliger Scrape-Run für Admin-Endpoints. Holt
 * frische Set-Daten von der CM-Webseite, upserted, und setzt parent-Links.
 */
export async function runExpansionsScrape(): Promise<{ scraped: number; written: number; parentsLinked: number }> {
  const log = logger.child({ scope: "cm-run-scrape" });
  const scraped = await scrapeExpansions();
  if (scraped.length === 0) {
    log.warn("scraper lieferte keine Daten — keine Aenderungen");
    return { scraped: 0, written: 0, parentsLinked: 0 };
  }
  const written = await upsertScrapedExpansions(scraped);
  const parentsLinked = await linkParentExpansions();
  log.info({ scraped: scraped.length, written, parentsLinked }, "scrape run complete");
  return { scraped: scraped.length, written, parentsLinked };
}

async function upsertScrapedExpansions(
  scraped: { idExpansion: number; name: string }[],
): Promise<number> {
  let written = 0;
  for (const batch of chunk(scraped, CHUNK_SIZE)) {
    const valid = batch
      .filter((e) => Number.isInteger(e.idExpansion))
      .map((e) => ({
        idExpansion: e.idExpansion,
        name: e.name.trim(),
        language: detectLanguage(e.name),
      }));
    if (valid.length === 0) continue;

    const now = new Date();
    const values = valid.map(({ idExpansion, name, language }) => {
      return Prisma.sql`(${idExpansion}, ${name}, ${language}, ${null}, ${null}, ${now}, ${now})`;
    });
    await prisma.$executeRaw`
      INSERT INTO "CardmarketExpansion"
        ("idExpansion","name","language","releaseDate","parentExpansionId","importedAt","updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("idExpansion") DO UPDATE SET
        "name" = EXCLUDED."name",
        "language" = EXCLUDED."language",
        "updatedAt" = EXCLUDED."updatedAt"
    `;
    written += valid.length;
  }
  return written;
}

/**
 * Setzt für jeden nicht-EN-Set einen passenden parentExpansionId, indem wir
 * Sets mit gleichem normalisierten Namen + Sprache "EN" suchen. Idempotent —
 * darf nach jedem Import laufen, überschreibt keine bereits gesetzten Werte
 * mit null.
 */
export async function linkParentExpansions(): Promise<number> {
  const log = logger.child({ scope: "cm-link-parents" });

  const all = await prisma.cardmarketExpansion.findMany({
    select: { idExpansion: true, name: true, language: true, parentExpansionId: true },
  });

  // Normalisierten Namen → idExpansion-der-EN-Variante mappen.
  const enByKey = new Map<string, number>();
  for (const row of all) {
    if (row.language === "EN") {
      const key = normalizeSetName(row.name);
      if (key && !enByKey.has(key)) enByKey.set(key, row.idExpansion);
    }
  }

  // Für alle Nicht-EN-Sets: passenden EN-Parent suchen + setzen.
  let linked = 0;
  for (const row of all) {
    if (row.language === "EN") continue;
    if (row.parentExpansionId != null) continue;  // schon verlinkt
    const key = normalizeSetName(row.name);
    const parentId = enByKey.get(key);
    if (!parentId || parentId === row.idExpansion) continue;
    await prisma.cardmarketExpansion.update({
      where: { idExpansion: row.idExpansion },
      data: { parentExpansionId: parentId },
    });
    linked++;
  }

  log.info({ linked }, "parent expansions linked");
  return linked;
}

async function bootstrapFromProducts(): Promise<{ count: number; source: "bootstrap" }> {
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

  if (distinct.length === 0) return { count: 0, source: "bootstrap" };

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
  return { count: distinct.length, source: "bootstrap" };
}
