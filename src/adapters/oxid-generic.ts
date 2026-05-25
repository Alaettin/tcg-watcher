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
  // Trader-online prints "14 ,99 €" with a space — normalise that too
  const m = raw.match(/(\d+(?:[\s.,]*\d{2,3})*)\s*[€]/);
  if (!m) return 0;
  const cleaned = m[1]!
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
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
  if (lower.includes("ready for shipping") || lower.includes("sofort lieferbar") || lower.includes("in stock") || lower.includes("to cart")) return "IN_STOCK";
  if (lower.includes("delivery alarm") || lower.includes("not on stock") || lower.includes("nicht auf lager") || lower.includes("re-ordered") || lower.includes("re - ordered")) return "OUT_OF_STOCK";
  if (lower.includes("preorder") || lower.includes("vorbestell")) return "PREORDER";
  return "UNKNOWN";
}

function cleanCardTitle(raw: string): string {
  // strip "To cart " / "To delivery alarm " prefix
  let s = raw.replace(/^\s*To (cart|delivery alarm)\s+/i, "");
  // strip "Language: ...€..." trailing block
  s = s.replace(/Language:.*$/i, "");
  // strip trailing price tokens
  s = s.replace(/\d+\s*[,.]\s*\d{2}\s*€.*$/, "");
  return s.replace(/\s+/g, " ").trim();
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

interface RawCard {
  href: string;
  text: string;
}

interface RawSingle {
  href: string;
  title: string;
  text: string;
}

export function createOxidAdapter(shopId: string, baseUrl: string): ShopAdapter {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const log = logger.child({ adapter: "oxid-generic", shopId });

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
      const url = `${trimmedBase}/index.php?cl=search&searchparam=${encodeURIComponent(term)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      // wait for Cloudflare challenge to clear if any
      await page.waitForTimeout(6000);

      const pageTitle = await page.title();
      const hitsMatch =
        pageTitle.match(/^\s*(\d+)\s+Hits\s+for/i) ??
        pageTitle.match(/^\s*(\d+)\s+Treffer\s+für/i);
      const isResultPage =
        !!hitsMatch ||
        /\bSuchergebnis|\bKeine Treffer\b|\bno results\b/i.test(pageTitle);

      if (hitsMatch && Number(hitsMatch[1]) === 0) return [];

      if (isResultPage) {
        const raw: RawCard[] = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll(".product-card"));
          return items
            .map((c) => {
              const link = c.querySelector("a[href]") as HTMLAnchorElement | null;
              return {
                href: link?.href ?? "",
                text: (c.textContent ?? "").replace(/\s+/g, " ").trim(),
              };
            })
            .filter((x) => x.href);
        });

        const results: RawListing[] = [];
        for (const r of raw) {
          results.push({
            externalId: externalIdFromUrl(r.href),
            url: r.href,
            title: cleanCardTitle(r.text),
            priceEur: parsePrice(r.text),
            status: deriveStatus(r.text),
          });
        }
        return results;
      }

      // OXID jumped straight to a product detail page (single match)
      const single: RawSingle | null = await page.evaluate(() => {
        const titleEl = document.querySelector('h1[itemprop="name"], h1, .product-title');
        const priceEl = document.querySelector('[itemprop="price"], .price, .product-price');
        return {
          href: location.href,
          title: (titleEl?.textContent ?? "").replace(/\s+/g, " ").trim(),
          text: (priceEl?.textContent ?? "") + " " + (document.body?.textContent?.replace(/\s+/g, " ").trim().slice(0, 1500) ?? ""),
        };
      });
      if (!single || !single.title) return [];

      return [{
        externalId: externalIdFromUrl(single.href),
        url: single.href,
        title: single.title,
        priceEur: parsePrice(single.text),
        status: deriveStatus(single.text),
      }];
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
          log.warn({ err: error, term }, "oxid search term failed");
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
        log.warn({ err: error }, "oxid health check failed");
        return false;
      }
    },
  };
}
