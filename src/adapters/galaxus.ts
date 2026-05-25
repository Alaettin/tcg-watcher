import { logger } from "../lib/logger.js";
import { getBrowser } from "./playwright-browser.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const BASE_URL = "https://www.galaxus.de";
const PAGE_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 2_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(raw: string): number {
  const m = raw.match(/(\d+(?:[.,]\d{2})?)\s*€/);
  if (!m) return 0;
  const cleaned = m[1]!.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  const m = url.match(/\/product\/[^/?#]+-(\d+)/);
  if (m) return m[1]!;
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return url;
  }
}

function deriveStatus(text: string): ListingAvailability {
  const lower = text.toLowerCase();
  if (lower.includes("vorbestell") || lower.includes("erscheint am")) return "PREORDER";
  if (lower.includes("sofort lieferbar") || lower.includes("an lager")) return "IN_STOCK";
  if (lower.includes("nicht lieferbar") || lower.includes("ausverkauft") || lower.includes("nicht verf")) return "OUT_OF_STOCK";
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
  context: string;
}

export function createGalaxusAdapter(shopId: string): ShopAdapter {
  const log = logger.child({ adapter: "galaxus", shopId });

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
      const url = `${BASE_URL}/de/search?q=${encodeURIComponent(term)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      await page.waitForTimeout(3500);

      const raw: RawProduct[] = await page.evaluate(() => {
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/product/"]'),
        );
        const seen = new Set<string>();
        const items: { href: string; title: string; context: string }[] = [];
        for (const a of anchors) {
          const href = a.href;
          if (!href || seen.has(href)) continue;
          const container =
            a.closest('article, [class*="product"], [class*="tile"], [class*="card"]') ?? a.parentElement;
          const text = (container?.textContent ?? "").replace(/\s+/g, " ").trim();
          let title = (a.getAttribute("aria-label") ?? a.title ?? a.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!title) {
            const heading = container?.querySelector('h2, h3, [class*="title"], [class*="name"]');
            title = (heading?.textContent ?? "").replace(/\s+/g, " ").trim();
          }
          if (!title) continue;
          seen.add(href);
          items.push({ href, title, context: text });
        }
        return items;
      });

      const results: RawListing[] = [];
      for (const r of raw) {
        results.push({
          externalId: externalIdFromUrl(r.href),
          url: r.href,
          title: r.title,
          priceEur: parsePrice(r.context),
          status: deriveStatus(r.context),
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
          log.warn({ err: error, term }, "galaxus search term failed");
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
        log.warn({ err: error }, "galaxus health check failed");
        return false;
      }
    },
  };
}
