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

function parsePrice(raw: string | undefined): number {
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
  if (lower.includes("ausverkauft") || lower.includes("nicht mehr verf")) return "OUT_OF_STOCK";
  if (lower.includes("vorbestell")) return "PREORDER";
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

export function createShopwareAdapter(shopId: string, baseUrl: string): ShopAdapter {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const log = logger.child({ adapter: "shopware-generic", shopId });

  async function searchOne(term: string): Promise<RawListing[]> {
    const url = `${trimmedBase}/suggest?search=${encodeURIComponent(term)}`;
    const response = await httpGetWithRetry<string>(
      url,
      {
        timeout: DEFAULT_TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "X-Requested-With": "XMLHttpRequest",
        },
        responseType: "text",
      },
      log,
    );

    const $ = cheerio.load(response.data);
    const results: RawListing[] = [];

    $(".search-suggest-product, li.js-result").each((_, el) => {
      const $el = $(el);
      const $link = $el.find("a.search-suggest-product-link, a[href]").first();
      const url = $link.attr("href");
      if (!url) return;
      const absoluteUrl = url.startsWith("http") ? url : `${trimmedBase}${url}`;

      const title = $link.attr("title")?.trim()
        || $el.find(".search-suggest-product-name").first().text().trim();
      if (!title) return;

      const priceText = $el.find(".search-suggest-product-price").last().text().trim();

      results.push({
        externalId: externalIdFromUrl(absoluteUrl),
        url: absoluteUrl,
        title,
        priceEur: parsePrice(priceText),
        status: deriveStatus($el.text()),
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
          log.warn({ err: error, term }, "shopware search term failed");
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
        log.warn({ err: error }, "shopware health check failed");
        return false;
      }
    },
  };
}
