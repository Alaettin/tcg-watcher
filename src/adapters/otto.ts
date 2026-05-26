import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../lib/logger.js";
import { httpGetWithRetry } from "./http.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const BASE_URL = "https://www.otto.de";
const DEFAULT_TIMEOUT_MS = 15_000;
const INTER_REQUEST_DELAY_MS = 600;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(raw: string | number | undefined): number {
  if (typeof raw === "number") return raw;
  if (!raw) return 0;
  const value = Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  const m = url.match(/-(S[0-9A-Z]+)\/?(?:\?|$)/i);
  if (m) return m[1]!;
  try {
    const u = new URL(url, BASE_URL);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return url;
  }
}

function deriveStatus(availability: string | undefined): ListingAvailability {
  if (!availability) return "UNKNOWN";
  const lower = availability.toLowerCase();
  if (lower.includes("instock") || lower.includes("limitedavailability")) return "IN_STOCK";
  if (lower.includes("preorder")) return "PREORDER";
  if (lower.includes("outofstock") || lower.includes("soldout") || lower.includes("discontinued")) return "OUT_OF_STOCK";
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

interface JsonLdProduct {
  "@type"?: string;
  name?: string;
  url?: string;
  offers?: { price?: string | number; priceCurrency?: string; availability?: string } | Array<{
    price?: string | number;
    priceCurrency?: string;
    availability?: string;
  }>;
}

function firstOffer(offers: JsonLdProduct["offers"]): { price?: string | number; availability?: string } {
  if (!offers) return {};
  if (Array.isArray(offers)) return offers[0] ?? {};
  return offers;
}

export function createOttoAdapter(shopId: string): ShopAdapter {
  const log = logger.child({ adapter: "otto", shopId });

  async function searchOne(term: string): Promise<RawListing[]> {
    const url = `${BASE_URL}/suche/${encodeURIComponent(term)}/`;
    const response = await httpGetWithRetry<string>(
      url,
      {
        timeout: DEFAULT_TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        },
        responseType: "text",
      },
      log,
    );

    const $ = cheerio.load(response.data);
    const results: RawListing[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).text();
      if (!raw) return;
      try {
        const data = JSON.parse(raw) as JsonLdProduct;
        if (data["@type"] !== "Product") return;
        const name = data.name;
        const path = data.url;
        if (!name || !path) return;

        const offer = firstOffer(data.offers);
        const absoluteUrl = path.startsWith("http") ? path : `${BASE_URL}${path}`;

        results.push({
          externalId: externalIdFromUrl(absoluteUrl),
          url: absoluteUrl,
          title: name.trim(),
          priceEur: parsePrice(offer.price),
          status: deriveStatus(offer.availability),
        });
      } catch {
        // ignore unparseable JSON-LD blocks
      }
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
          log.warn({ err: error, term }, "otto search term failed");
        }
      }

      return dedupByExternalId(collected);
    },

    async isAvailable() {
      try {
        const response = await axios.head(`${BASE_URL}/`, {
          timeout: DEFAULT_TIMEOUT_MS,
          headers: { "User-Agent": USER_AGENT },
          validateStatus: () => true,
        });
        return response.status >= 200 && response.status < 400;
      } catch (error) {
        log.warn({ err: error }, "otto health check failed");
        return false;
      }
    },
  };
}
