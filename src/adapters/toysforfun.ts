import { logger } from "../lib/logger.js";
import { getBrowser } from "./playwright-browser.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const BRAND_URL = "https://www.toys-for-fun.com/de/marken/pokemon";
const PAGE_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function parsePrice(raw: string): number {
  const m = raw.match(/(\d+(?:[.,]\d{3})*[.,]\d{2})\s*€?/);
  if (!m) return 0;
  const cleaned = m[1]!.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "").replace(/\.html$/, "");
  } catch {
    return url;
  }
}

function deriveStatus(text: string): ListingAvailability {
  const lower = text.toLowerCase();
  if (lower.includes("ausverkauft") || lower.includes("nicht lieferbar") || lower.includes("nicht verf")) return "OUT_OF_STOCK";
  if (lower.includes("vorbestell")) return "PREORDER";
  if (lower.includes("lieferbar") || lower.includes("auf lager") || lower.includes("in den warenkorb") || lower.includes("verf")) return "IN_STOCK";
  return "UNKNOWN";
}

function matchesNegativeTerm(title: string, negativeTerms: string[]): boolean {
  const lower = title.toLowerCase();
  return negativeTerms.some((term) => lower.includes(term.toLowerCase()));
}

function dedupByExternalId(listings: RawListing[]): RawListing[] {
  const map = new Map<string, RawListing>();
  for (const l of listings) {
    if (!map.has(l.externalId)) map.set(l.externalId, l);
  }
  return [...map.values()];
}

interface RawProduct {
  href: string;
  title: string;
  text: string;
}

export function createToysForFunAdapter(shopId: string): ShopAdapter {
  const log = logger.child({ adapter: "toysforfun", shopId });

  async function fetchBrandPage(): Promise<RawListing[]> {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "de-DE",
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" },
    });
    const page = await context.newPage();

    try {
      await page.goto(BRAND_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      // accept cookies
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, a"));
        for (const b of buttons) {
          const text = (b.textContent ?? "").trim().toLowerCase();
          if (/akzeptier|alle annehmen|alle akzeptier|accept all|zustimmen|einverstanden/.test(text)) {
            (b as HTMLElement).click();
            return;
          }
        }
      }).catch(() => null);
      await page.waitForTimeout(4000);

      const raw: RawProduct[] = await page.evaluate(() => {
        const items: Array<{ href: string; title: string; text: string }> = [];
        const seen = new Set<string>();
        const tiles = Array.from(document.querySelectorAll<HTMLElement>(".cs-product-tile"));
        for (const tile of tiles) {
          const urlEl = tile.querySelector("[data-product-url]");
          const href = urlEl?.getAttribute("data-product-url")
            ?? (tile.querySelector("a[href*='/de/']") as HTMLAnchorElement | null)?.href
            ?? "";
          if (!href || seen.has(href)) continue;
          const img = tile.querySelector("img");
          const title = (img?.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim();
          if (!title) continue;
          seen.add(href);
          items.push({
            href,
            title,
            text: tile.textContent?.replace(/\s+/g, " ").trim().slice(0, 400) ?? "",
          });
        }
        return items;
      });

      const results: RawListing[] = [];
      for (const r of raw) {
        results.push({
          externalId: externalIdFromUrl(r.href),
          url: r.href,
          title: r.title,
          priceEur: parsePrice(r.text),
          status: deriveStatus(r.text),
        });
      }
      return dedupByExternalId(results);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  return {
    shopId,

    async search(_searchTerms, negativeTerms = []) {
      // Single brand-page scrape; ProductMatcher filters per-product after the fact.
      try {
        const items = await fetchBrandPage();
        return items.filter((item) => !matchesNegativeTerm(item.title, negativeTerms));
      } catch (error) {
        log.warn({ err: error }, "toysforfun brand page fetch failed");
        return [];
      }
    },

    async isAvailable() {
      try {
        const browser = await getBrowser();
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        const response = await page.goto("https://www.toys-for-fun.com/de/", { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        const ok = !!response && response.status() >= 200 && response.status() < 400;
        await page.close();
        await context.close();
        return ok;
      } catch (error) {
        log.warn({ err: error }, "toysforfun health check failed");
        return false;
      }
    },
  };
}
