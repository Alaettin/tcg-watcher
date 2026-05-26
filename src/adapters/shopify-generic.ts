import axios from "axios";
import { logger } from "../lib/logger.js";
import { httpGetWithRetry } from "./http.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const INTER_REQUEST_DELAY_MS = 400;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ShopifySuggestProduct {
  id?: number | string;
  handle?: string;
  url?: string;
  title: string;
  price?: number | string;
  available?: boolean;
  variants?: Array<{
    id?: number | string;
    price?: number | string;
    available?: boolean;
  }>;
}

interface ShopifySuggestResponse {
  resources?: {
    results?: {
      products?: ShopifySuggestProduct[];
    };
  };
}

function normalizePrice(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1000 ? value / 100 : value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.,-]/g, "").replace(",", ".");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed > 1000 ? parsed / 100 : parsed;
    }
  }
  return 0;
}

function deriveStatus(product: ShopifySuggestProduct): ListingAvailability {
  if (typeof product.available === "boolean") {
    return product.available ? "IN_STOCK" : "OUT_OF_STOCK";
  }
  if (product.variants?.length) {
    const anyAvailable = product.variants.some((v) => v.available === true);
    return anyAvailable ? "IN_STOCK" : "OUT_OF_STOCK";
  }
  return "UNKNOWN";
}

function buildUrl(baseUrl: string, product: ShopifySuggestProduct): string {
  if (product.url) {
    return product.url.startsWith("http") ? product.url : `${baseUrl}${product.url}`;
  }
  if (product.handle) {
    return `${baseUrl}/products/${product.handle}`;
  }
  return baseUrl;
}

function matchesNegativeTerm(title: string, negativeTerms: string[]): boolean {
  const lower = title.toLowerCase();
  return negativeTerms.some((term) => lower.includes(term.toLowerCase()));
}

function dedupByExternalId(listings: RawListing[]): RawListing[] {
  const map = new Map<string, RawListing>();
  for (const listing of listings) {
    if (!map.has(listing.externalId)) {
      map.set(listing.externalId, listing);
    }
  }
  return [...map.values()];
}

export function createShopifyAdapter(shopId: string, baseUrl: string): ShopAdapter {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const log = logger.child({ adapter: "shopify-generic", shopId });

  return {
    shopId,

    async search(searchTerms, negativeTerms = []) {
      const collected: RawListing[] = [];

      for (let i = 0; i < searchTerms.length; i++) {
        const term = searchTerms[i]!;
        if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
        try {
          const url = `${trimmedBase}/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product&resources[limit]=10`;
          const response = await httpGetWithRetry<ShopifySuggestResponse>(
            url,
            {
              timeout: DEFAULT_TIMEOUT_MS,
              headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/json",
              },
            },
            log,
          );

          const products = response.data.resources?.results?.products ?? [];

          for (const product of products) {
            const externalId = String(product.id ?? product.handle ?? product.url ?? product.title);
            const listing: RawListing = {
              externalId,
              url: buildUrl(trimmedBase, product),
              title: product.title,
              priceEur: normalizePrice(product.price ?? product.variants?.[0]?.price),
              status: deriveStatus(product),
              rawData: product as unknown as Record<string, unknown>,
            };

            if (matchesNegativeTerm(listing.title, negativeTerms)) {
              continue;
            }

            collected.push(listing);
          }
        } catch (error) {
          log.warn({ err: error, term }, "shopify search term failed");
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
        log.warn({ err: error }, "shopify health check failed");
        return false;
      }
    },
  };
}
