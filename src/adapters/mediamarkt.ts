import { logger } from "../lib/logger.js";
import { getBrowser } from "./playwright-browser.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const PAGE_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 2_500;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(raw: string): number {
  const m = raw.match(/(\d+[.,]\d{2})/);
  if (!m) return 0;
  const cleaned = m[1]!.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  const m = url.match(/-(\d+)\.html/);
  if (m) return m[1]!;
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return url;
  }
}

function deriveStatusFromCard(deliveryStates: string[]): ListingAvailability {
  const joined = deliveryStates.join(" ").toLowerCase();
  if (joined.includes("available")) return "IN_STOCK";
  if (joined.includes("preorder") || joined.includes("vorbestell")) return "PREORDER";
  if (joined.includes("unavailable") || joined.includes("ausverkauft") || joined.includes("nicht verf")) return "OUT_OF_STOCK";
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
  priceText: string;
  deliveryStates: string[];
}

export function createMediaMarktAdapter(shopId: string, baseUrl: string): ShopAdapter {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const log = logger.child({ adapter: "mediamarkt", shopId });

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
      const url = `${trimmedBase}/de/search.html?query=${encodeURIComponent(term)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });

      await page.waitForSelector('[data-test="mms-product-card"], [data-test="mms-empty-search"]', {
        timeout: PAGE_TIMEOUT_MS,
        state: "attached",
      }).catch(() => {});
      await page.waitForTimeout(2500);

      const raw: RawProduct[] = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[data-test="mms-product-card"]'));
        return cards.map((c) => {
          const link = c.querySelector('a[href*="/de/product/"]') as HTMLAnchorElement | null;
          const titleEl = c.querySelector('p[data-test*="title"]') ?? c.querySelector('p');
          const priceEl = c.querySelector('[data-test*="price"]') as HTMLElement | null;
          const delivery = Array.from(c.querySelectorAll('[data-test*="cofr-delivery"]')).map(
            (el) => el.getAttribute("data-test") ?? "",
          );
          return {
            href: link?.href ?? "",
            title: (titleEl?.textContent ?? "").trim(),
            priceText: priceEl?.innerText ?? "",
            deliveryStates: delivery,
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
          priceEur: parsePrice(r.priceText),
          status: deriveStatusFromCard(r.deliveryStates),
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
          log.warn({ err: error, term }, "mediamarkt search term failed");
        }
      }

      return dedupByExternalId(collected);
    },

    async isAvailable() {
      try {
        const browser = await getBrowser();
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        const response = await page.goto(trimmedBase, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        const ok = !!response && response.status() >= 200 && response.status() < 400;
        await page.close();
        await context.close();
        return ok;
      } catch (error) {
        log.warn({ err: error }, "mediamarkt health check failed");
        return false;
      }
    },
  };
}
