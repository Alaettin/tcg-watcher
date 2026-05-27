import * as cheerio from "cheerio";
import { logger } from "../lib/logger.js";
import { getBrowser } from "../adapters/playwright-browser.js";

export interface ScrapedExpansion {
  idExpansion: number;
  name: string;
}

const SOURCES: { url: string; label: string }[] = [
  { url: "https://www.cardmarket.com/en/Pokemon/Products/Singles", label: "singles" },
  { url: "https://www.cardmarket.com/en/Pokemon/Products/Booster-Boxes", label: "boosters" },
  { url: "https://www.cardmarket.com/en/Pokemon", label: "root" },
];

const NAV_TIMEOUT_MS = 30_000;
const MIN_VALID_COUNT = 50;

/**
 * Holt eine Liste aller Pokemon-Expansions von cardmarket.com.
 *
 * Cardmarket sitzt hinter Cloudflare und blockt einfache HTTP-Clients per
 * 403. Wir nutzen daher den bestehenden Playwright-Stealth-Singleton aus
 * `playwright-browser.ts` (dieselbe Pipeline wie die Shop-Adapter), holen
 * den finalen HTML-Snapshot und parsen ihn mit cheerio.
 *
 * Liefert leeres Array bei < MIN_VALID_COUNT Funden — Caller behält dann
 * den bestehenden DB-Stand (kein Replace, nur Upsert).
 */
export async function scrapeExpansions(): Promise<ScrapedExpansion[]> {
  const log = logger.child({ scope: "cm-scrape-expansions" });

  const browser = await getBrowser();
  // Frischer Context pro Run — sonst akkumulieren Cookies/Storage zwischen
  // Aufrufen und der nächste Scrape kann unerwartet anders aussehen.
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });

  try {
    for (const source of SOURCES) {
      const page = await ctx.newPage();
      try {
        log.info({ url: source.url }, "navigating expansion list");
        const response = await page.goto(source.url, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
        const status = response?.status() ?? 0;
        if (status >= 400) {
          log.warn({ source: source.label, status }, "scrape source returned error status");
          continue;
        }
        // Kurz auf JS-Rendering warten — viele CM-Seiten füllen das
        // Expansion-Dropdown clientseitig nach.
        await page
          .waitForSelector('select option, a[href*="/Expansions/"], [data-expansion-id]', {
            timeout: 8_000,
          })
          .catch(() => {});

        const html = await page.content();
        const found = extractExpansions(html);
        log.info({ source: source.label, count: found.length }, "expansions extracted");
        if (found.length >= MIN_VALID_COUNT) {
          return found;
        }
      } catch (err) {
        log.warn(
          { source: source.label, err: (err as Error).message },
          "scrape source failed, trying next",
        );
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await ctx.close().catch(() => {});
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
