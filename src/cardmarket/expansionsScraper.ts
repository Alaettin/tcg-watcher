import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../lib/logger.js";

export interface ScrapedExpansion {
  idExpansion: number;
  name: string;
}

const SOURCES: { url: string; label: string }[] = [
  { url: "https://www.cardmarket.com/en/Pokemon/Products/Singles", label: "singles" },
  { url: "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes", label: "boosters" },
  { url: "https://www.cardmarket.com/en/Pokemon", label: "root" },
];

const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = "tcg-watcher/cardmarket-scraper (+https://github.com/Alaettin/tcg-watcher)";
const MIN_VALID_COUNT = 50;

/**
 * Holt eine Liste aller Pokemon-Expansions mit `idExpansion` + Name von der
 * öffentlichen Cardmarket-Webseite. Mehrere Quellen + Selektoren als
 * Fallback, weil die HTML-Struktur sich ohne Vorwarnung ändert.
 *
 * Liefert leeres Array bei < MIN_VALID_COUNT Funden — Caller behält dann
 * den bestehenden DB-Stand (kein Replace, nur Upsert).
 */
export async function scrapeExpansions(): Promise<ScrapedExpansion[]> {
  const log = logger.child({ scope: "cm-scrape-expansions" });

  for (const source of SOURCES) {
    try {
      log.info({ url: source.url }, "fetching expansion list");
      const res = await axios.get<string>(source.url, {
        timeout: REQUEST_TIMEOUT_MS,
        responseType: "text",
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.7,de;q=0.3",
        },
      });
      const found = extractExpansions(res.data);
      log.info({ source: source.label, count: found.length }, "expansions extracted");
      if (found.length >= MIN_VALID_COUNT) {
        return found;
      }
    } catch (err) {
      log.warn(
        { source: source.label, err: (err as Error).message },
        "scrape source failed, trying next",
      );
    }
  }

  log.warn({ tried: SOURCES.map((s) => s.label) }, "no source returned enough expansions");
  return [];
}

/**
 * Versucht mehrere Selektoren, damit kleine HTML-Änderungen am CM-Layout
 * den Scraper nicht direkt killen. Dedupliziert per idExpansion.
 */
function extractExpansions(html: string): ScrapedExpansion[] {
  const $ = cheerio.load(html);
  const map = new Map<number, string>();

  const collect = (id: number | null, name: string | null) => {
    if (!id || !Number.isInteger(id) || !name) return;
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 200) return;
    // Erst-Eintrag gewinnt — manche Quellen haben Sortier-Mehrfach-Listings.
    if (!map.has(id)) {
      map.set(id, trimmed);
    }
  };

  // Strategie 1: <option value="123">Set Name</option> in Filter-Dropdowns.
  $("select option").each((_i, el) => {
    const value = $(el).attr("value");
    const text = $(el).text();
    const id = value ? Number(value) : NaN;
    if (Number.isFinite(id)) collect(id, text);
  });

  // Strategie 2: Anchor-Tags mit /Expansions/<id> oder /Products?idExpansion=<id>.
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text();
    const m =
      href.match(/\/Expansions\/(\d+)/) ??
      href.match(/[?&]idExpansion=(\d+)/) ??
      href.match(/\/Pokemon\/Expansions\/[^/]+\/(\d+)/);
    if (m && m[1]) collect(Number(m[1]), text);
  });

  // Strategie 3: data-id-Attribute auf List-Items.
  $("[data-expansion-id]").each((_i, el) => {
    const id = Number($(el).attr("data-expansion-id"));
    const text = $(el).text() || $(el).attr("data-name") || "";
    if (Number.isFinite(id)) collect(id, text);
  });

  return Array.from(map.entries()).map(([idExpansion, name]) => ({ idExpansion, name }));
}
