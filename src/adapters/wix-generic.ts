import { logger } from "../lib/logger.js";
import { getBrowser } from "./playwright-browser.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const PAGE_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 2_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(raw: string): number {
  const m = raw.match(/Preis\s*(\d+(?:[.,]\d{2})?)\s*€/) ?? raw.match(/(\d+[.,]\d{2})\s*€/);
  if (!m) return 0;
  const cleaned = m[1]!.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  const m = url.match(/\/product-page\/([^/?#]+)/);
  if (m) return m[1]!;
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return url;
  }
}

function cleanTitle(raw: string): string {
  // Wix renders cards as "Title<wbr>PreisX €inkl. MwSt." — strip the trailing price part
  return raw.replace(/Preis.*$/, "").replace(/\s+/g, " ").trim();
}

function deriveStatus(text: string): ListingAvailability {
  const lower = text.toLowerCase();
  if (lower.includes("ausverkauft") || lower.includes("nicht verf") || lower.includes("vergriffen")) return "OUT_OF_STOCK";
  if (lower.includes("vorbestell")) return "PREORDER";
  // Wix shows "Preis0,00 €" for items without a public price (often preorder or hidden)
  // We treat presence of a positive price as IN_STOCK proxy; UNKNOWN otherwise.
  if (/preis\s*[1-9]/i.test(text)) return "IN_STOCK";
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
  text: string;
}

export function createWixAdapter(shopId: string, baseUrl: string): ShopAdapter {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const log = logger.child({ adapter: "wix-generic", shopId });

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
      // Wix search via the public search page (Wix uses /search or ?s=...)
      // We try a couple of URL forms — first match wins.
      const candidates = [
        `${trimmedBase}/?s=${encodeURIComponent(term)}`,
        `${trimmedBase}/search?q=${encodeURIComponent(term)}`,
      ];
      for (const url of candidates) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS }).catch(() => {});
        await page.waitForTimeout(3500);
        const probe = await page.evaluate(() =>
          document.querySelectorAll('a[href*="/product-page/"]').length,
        );
        if (probe > 0) break;
      }

      const raw: RawProduct[] = await page.evaluate(() => {
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/product-page/"]'),
        );
        const seen = new Set<string>();
        const items: { href: string; text: string }[] = [];
        for (const a of anchors) {
          const href = a.href;
          if (!href || seen.has(href)) continue;
          const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          seen.add(href);
          items.push({ href, text });
        }
        return items;
      });

      const results: RawListing[] = [];
      for (const r of raw) {
        results.push({
          externalId: externalIdFromUrl(r.href),
          url: r.href,
          title: cleanTitle(r.text),
          priceEur: parsePrice(r.text),
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
          log.warn({ err: error, term }, "wix search term failed");
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
        log.warn({ err: error }, "wix health check failed");
        return false;
      }
    },
  };
}
