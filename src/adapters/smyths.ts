import { logger } from "../lib/logger.js";
import { getBrowser } from "./playwright-browser.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const BASE_URL = "https://www.smythstoys.com/de/de-de";
const PAGE_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 2_500;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return url;
  }
}

function deriveStatus(text: string): ListingAvailability {
  const lower = text.toLowerCase();
  if (lower.includes("ausverkauft") || lower.includes("nicht verf")) return "OUT_OF_STOCK";
  if (lower.includes("vorbestell") || lower.includes("vorbestellung")) return "PREORDER";
  if (lower.includes("verfügbar") || lower.includes("in den warenkorb")) return "IN_STOCK";
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
  price: string;
  text: string;
}

export function createSmythsAdapter(shopId: string): ShopAdapter {
  const log = logger.child({ adapter: "smyths", shopId });

  async function searchOne(term: string): Promise<RawListing[]> {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "de-DE",
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" },
    });
    const page = await context.newPage();

    try {
      const url = `${BASE_URL}/search/?text=${encodeURIComponent(term)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });

      await page.waitForSelector('.product-tile, .product, [data-product-tile], li.product-item, .product-listing-item, .no-results', {
        timeout: PAGE_TIMEOUT_MS,
        state: "attached",
      }).catch(() => {});

      const raw: RawProduct[] = await page.evaluate(() => {
        const tiles = Array.from(
          document.querySelectorAll(
            '.product-tile, [data-product-tile], li.product-item, .product-listing-item, .product',
          ),
        );
        return tiles.map((t) => {
          const link = t.querySelector('a[href*="/p/"], a.product-tile-link, a.product-name, a[href]') as HTMLAnchorElement | null;
          const titleEl = t.querySelector('.product-name, .product-tile-name, .name, h3, [itemprop="name"]');
          const priceEl = t.querySelector(
            '.product-tile-price, .price-now, .product-price, .price, [itemprop="price"]',
          );
          return {
            href: link?.href ?? "",
            title: (titleEl?.textContent ?? link?.getAttribute("title") ?? link?.textContent ?? "").trim(),
            price: (priceEl?.textContent ?? priceEl?.getAttribute("content") ?? "").trim(),
            text: (t.textContent ?? "").slice(0, 500),
          };
        });
      });

      const results: RawListing[] = [];
      for (const r of raw) {
        if (!r.href || !r.title) continue;
        results.push({
          externalId: externalIdFromUrl(r.href),
          url: r.href,
          title: r.title,
          priceEur: parsePrice(r.price),
          status: deriveStatus(r.text),
        });
      }
      return results;
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  return {
    shopId,

    async search(searchTerms, negativeTerms = []) {
      const collected: RawListing[] = [];

      for (let i = 0; i < searchTerms.length; i++) {
        const term = searchTerms[i]!;
        if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
        try {
          const items = await searchOne(term);
          for (const item of items) {
            if (matchesNegativeTerm(item.title, negativeTerms)) continue;
            collected.push(item);
          }
        } catch (error) {
          log.warn({ err: error, term }, "smyths search term failed");
        }
      }

      return dedupByExternalId(collected);
    },

    async isAvailable() {
      try {
        const browser = await getBrowser();
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        const ok = !!response && response.status() >= 200 && response.status() < 400;
        await page.close();
        await context.close();
        return ok;
      } catch (error) {
        log.warn({ err: error }, "smyths health check failed");
        return false;
      }
    },
  };
}
