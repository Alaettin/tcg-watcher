import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../lib/logger.js";
import { httpGetWithRetry } from "./http.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const INTER_REQUEST_DELAY_MS = 600;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveStatus(wrapperText: string): ListingAvailability {
  const lower = wrapperText.toLowerCase();
  if (lower.includes("ausverkauft") || lower.includes("nicht mehr verf")) return "OUT_OF_STOCK";
  if (lower.includes("vorbestell")) return "PREORDER";
  return "UNKNOWN";
}

function parsePrice(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
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

export function createJtlAdapter(shopId: string, baseUrl: string): ShopAdapter {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const log = logger.child({ adapter: "jtl-generic", shopId });

  async function searchOne(term: string): Promise<RawListing[]> {
    const url = `${trimmedBase}/?suche=${encodeURIComponent(term)}`;
    const response = await httpGetWithRetry<string>(
      url,
      {
        timeout: DEFAULT_TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
        responseType: "text",
      },
      log,
    );

    const $ = cheerio.load(response.data);
    const results: RawListing[] = [];

    $("[itemtype$='Product'], .product-wrapper, .productbox").each((_, el) => {
      const $el = $(el);
      const title = $el.find('[itemprop="name"]').first().attr("content")
        || $el.find('[itemprop="name"]').first().text().trim();
      const linkAttr = $el.find('[itemprop="url"]').first().attr("href")
        || $el.find('a.productbox-title-link, a[href*="/"]').first().attr("href");
      const priceAttr = $el.find('[itemprop="price"]').first().attr("content")
        || $el.find('[itemprop="price"]').first().text();
      if (!title || !linkAttr) return;

      const absoluteUrl = linkAttr.startsWith("http") ? linkAttr : `${trimmedBase}${linkAttr}`;
      const status = deriveStatus($el.text());

      results.push({
        externalId: externalIdFromUrl(absoluteUrl),
        url: absoluteUrl,
        title: title.trim(),
        priceEur: parsePrice(priceAttr),
        status,
      });
    });

    return results;
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
          log.warn({ err: error, term }, "jtl search term failed");
        }
      }

      return dedupByExternalId(collected);
    },

    async isAvailable() {
      try {
        const response = await axios.head(`${trimmedBase}/`, {
          timeout: DEFAULT_TIMEOUT_MS,
          headers: { "User-Agent": USER_AGENT },
          validateStatus: () => true,
        });
        return response.status >= 200 && response.status < 400;
      } catch (error) {
        log.warn({ err: error }, "jtl health check failed");
        return false;
      }
    },
  };
}
