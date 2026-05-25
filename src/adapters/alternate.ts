import { logger } from "../lib/logger.js";
import { getBrowser } from "./playwright-browser.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const CATEGORY_URL = "https://www.alternate.de/Spielzeug/Sammelkarten";
const PAGE_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function parsePrice(raw: string): number {
  const m = raw.match(/(\d+(?:[.,]\d{2}|[.,]\d{3})*[.,]\d{2})\s*[€]/);
  if (!m) return 0;
  const cleaned = m[1]!.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  const m = url.match(/\/product\/(\d+)/);
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
  if (lower.includes("ausverkauft") || lower.includes("nicht lieferbar") || lower.includes("vergriffen")) return "OUT_OF_STOCK";
  if (lower.includes("vorbestell")) return "PREORDER";
  if (lower.includes("lieferbar") || lower.includes("auf lager") || lower.includes("in den warenkorb")) return "IN_STOCK";
  return "UNKNOWN";
}

function matchesNegativeTerm(title: string, negativeTerms: string[]): boolean {
  const lower = title.toLowerCase();
  return negativeTerms.some((term) => lower.includes(term.toLowerCase()));
}

interface RawProduct {
  href: string;
  title: string;
  priceText: string;
  text: string;
}

export function createAlternateAdapter(shopId: string): ShopAdapter {
  const log = logger.child({ adapter: "alternate", shopId });

  async function fetchCategory(): Promise<RawListing[]> {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "de-DE",
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" },
    });
    const page = await context.newPage();

    try {
      await page.goto(CATEGORY_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      // accept cookie banner if present
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
      await page.waitForSelector(".productBox", { timeout: PAGE_TIMEOUT_MS, state: "attached" }).catch(() => {});
      await page.waitForTimeout(2500);

      const raw: RawProduct[] = await page.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll<HTMLAnchorElement>("a.productBox"));
        return boxes.map((b) => ({
          href: b.href,
          title: (b.querySelector(".product-name, .productPicker_name, .name")?.textContent
            ?? b.getAttribute("title")
            ?? b.querySelector("img")?.getAttribute("alt")
            ?? b.textContent
            ?? "").replace(/\s+/g, " ").trim(),
          priceText: (b.querySelector(".price")?.textContent ?? "").trim(),
          text: (b.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
        }));
      });

      const results: RawListing[] = [];
      for (const r of raw) {
        if (!r.href || !r.title) continue;
        results.push({
          externalId: externalIdFromUrl(r.href),
          url: r.href,
          title: r.title.replace(/^(?:Topseller|Neu|Bestseller|Angebot)\s+/i, "").trim(),
          priceEur: parsePrice(r.priceText || r.text),
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

    async search(_searchTerms, negativeTerms = []) {
      // Alternate is a single category-page scrape, so search-terms are ignored.
      // The ProductMatcher pairs each listing to a watchlist product after-the-fact.
      try {
        const items = await fetchCategory();
        return items.filter((item) => !matchesNegativeTerm(item.title, negativeTerms));
      } catch (error) {
        log.warn({ err: error }, "alternate category fetch failed");
        return [];
      }
    },

    async isAvailable() {
      try {
        const browser = await getBrowser();
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        const response = await page.goto(CATEGORY_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        const ok = !!response && response.status() >= 200 && response.status() < 400;
        await page.close();
        await context.close();
        return ok;
      } catch (error) {
        log.warn({ err: error }, "alternate health check failed");
        return false;
      }
    },
  };
}
