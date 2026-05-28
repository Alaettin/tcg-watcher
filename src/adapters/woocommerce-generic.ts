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

// WooCommerce Store-API (öffentlich, kein Auth-Key). Nur die genutzten Felder.
interface WooStorePrices {
  price?: string; // String in kleinster Währungseinheit (z.B. Cent)
  currency_minor_unit?: number; // i.d.R. 2
}

interface WooStoreProduct {
  id?: number | string;
  name?: string;
  permalink?: string;
  prices?: WooStorePrices;
  is_in_stock?: boolean;
  is_on_backorder?: boolean;
  is_purchasable?: boolean;
}

function normalizePrice(prices: WooStorePrices | undefined): number {
  if (!prices || prices.price == null) return 0;
  const minor = typeof prices.currency_minor_unit === "number" ? prices.currency_minor_unit : 2;
  const raw = Number(prices.price);
  if (!Number.isFinite(raw)) return 0;
  return raw / 10 ** minor;
}

function deriveStatus(product: WooStoreProduct): ListingAvailability {
  if (product.is_in_stock === true) return "IN_STOCK";
  if (product.is_on_backorder === true) return "PREORDER";
  if (product.is_in_stock === false) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

function matchesNegativeTerm(title: string, negativeTerms: string[]): boolean {
  const lower = title.toLowerCase();
  return negativeTerms.some((term) => lower.includes(term.toLowerCase()));
}

function dedupByExternalId(listings: RawListing[]): RawListing[] {
  const map = new Map<string, RawListing>();
  for (const listing of listings) {
    if (!map.has(listing.externalId)) map.set(listing.externalId, listing);
  }
  return [...map.values()];
}

export function createWooCommerceAdapter(shopId: string, baseUrl: string): ShopAdapter {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const log = logger.child({ adapter: "woocommerce-generic", shopId });

  return {
    shopId,

    async search(searchTerms, negativeTerms = []) {
      const collected: RawListing[] = [];

      for (let i = 0; i < searchTerms.length; i++) {
        const term = searchTerms[i]!;
        if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
        try {
          const url = `${trimmedBase}/wp-json/wc/store/v1/products?search=${encodeURIComponent(term)}&per_page=10`;
          const response = await httpGetWithRetry<WooStoreProduct[]>(
            url,
            {
              timeout: DEFAULT_TIMEOUT_MS,
              headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            },
            log,
          );

          const products = Array.isArray(response.data) ? response.data : [];

          for (const product of products) {
            if (!product.name) continue;
            const externalId = String(product.id ?? product.permalink ?? product.name);
            const listing: RawListing = {
              externalId,
              url: product.permalink ?? trimmedBase,
              title: product.name,
              priceEur: normalizePrice(product.prices),
              status: deriveStatus(product),
              rawData: product as unknown as Record<string, unknown>,
            };
            if (matchesNegativeTerm(listing.title, negativeTerms)) continue;
            collected.push(listing);
          }
        } catch (error) {
          log.warn({ err: error, term }, "woocommerce search term failed");
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
        log.warn({ err: error }, "woocommerce health check failed");
        return false;
      }
    },
  };
}
