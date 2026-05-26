import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../lib/logger.js";
import { httpGetWithRetry } from "./http.js";
import type { ListingAvailability, RawListing, ShopAdapter } from "./ShopAdapter.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const BASE_URL = "https://www.ideeundspiel.com";
const LISTING_URL = `${BASE_URL}/c/pokemon-markenshop-2024/alle-sammelkartenprodukte?limit=96`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function parsePrice(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function externalIdFromUrl(url: string): string {
  const match = url.match(/POKEMON\d+[A-Z]?/i);
  return match ? match[0].toUpperCase() : url;
}

function matchesNegativeTerm(title: string, negativeTerms: string[]): boolean {
  const lower = title.toLowerCase();
  return negativeTerms.some((term) => lower.includes(term.toLowerCase()));
}

export function createIdeeUndSpielAdapter(shopId: string): ShopAdapter {
  const log = logger.child({ adapter: "ideeundspiel", shopId });

  return {
    shopId,

    async search(_searchTerms, negativeTerms = []) {
      const response = await httpGetWithRetry<string>(
        LISTING_URL,
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
      const seen = new Set<string>();
      const results: RawListing[] = [];

      $(".item-content").each((_, el) => {
        const $el = $(el);
        const $titleLink = $el.find('a[href*="/p/"][href*="POKEMON"]').first();
        const href = $titleLink.attr("href");
        const $h4 = $el.find("h4.item-title").first();
        const title = (
          $h4.find("span.d-md-none").text().trim()
          || $h4.find("span.d-md-block").text().trim()
          || $h4.text().trim()
        ).replace(/\s+/g, " ");
        const priceText = $el.find("span.sales-price").first().text();
        if (!href || !title) return;

        const absoluteUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        const externalId = externalIdFromUrl(absoluteUrl);
        if (seen.has(externalId)) return;
        seen.add(externalId);

        if (matchesNegativeTerm(title, negativeTerms)) return;

        const wrapperText = $el.text().toLowerCase();
        let status: ListingAvailability = "UNKNOWN";
        if (wrapperText.includes("ausverkauft") || wrapperText.includes("vergriffen")) {
          status = "OUT_OF_STOCK";
        } else if (wrapperText.includes("vorbestell")) {
          status = "PREORDER";
        }

        results.push({
          externalId,
          url: absoluteUrl,
          title,
          priceEur: parsePrice(priceText),
          status,
        });
      });

      log.debug({ count: results.length }, "ideeundspiel parsed listings");
      return results;
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
        log.warn({ err: error }, "ideeundspiel health check failed");
        return false;
      }
    },
  };
}
