import axios from "axios";
import { logger } from "../lib/logger.js";
import type { OfflineAdapter, OfflineRawDeal } from "./OfflineAdapter.js";

// Reverse-engineered auth pattern (community pattern, see sydev/marktguru on GitHub):
// 1. GET https://www.marktguru.de/ → HTML
// 2. parse first <script type="application/json">…</script>
// 3. extract config.apiKey + config.clientKey
// 4. use those as x-apikey + x-clientkey headers against api.marktguru.de
//
// API: GET https://api.marktguru.de/api/v1/search?q=<term>&zipCode=<plz>&limit=<n>
// Returns: { totalResults, results: [{ data: { id, product:{name}, advertisers:[{id,name}],
//            brand:{name}, categories:[…], price, oldPrice, validityDates:[{from,to}], ...} }] }

const HOMEPAGE = "https://www.marktguru.de/";
const API_BASE = "https://api.marktguru.de/api/v1";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;
// CDN image URL pattern (constructed from offer-id, image-index)
const CDN_IMAGE = (offerId: number) =>
  `https://cdn.marktguru.de/api/v1/offers/${offerId}/images/0/medium`;

// Maps marktguru's advertiser name → our OfflineRetailer.id (lower-kebab).
// We keep this list close to the seed file; new merchants will appear with
// auto-derived ids until we add them.
function normalizeRetailer(advertiserName: string): string {
  const n = advertiserName.toLowerCase().trim();
  const map: Record<string, string> = {
    "rewe": "rewe",
    "edeka": "edeka",
    "kaufland": "kaufland",
    "penny": "penny",
    "lidl": "lidl",
    "aldi süd": "aldi-sued",
    "aldi nord": "aldi-nord",
    "netto marken-discount": "netto",
    "netto": "netto",
    "real": "real",
    "globus": "globus",
    "famila": "famila",
    "marktkauf": "marktkauf",
    "dm": "dm",
    "rossmann": "rossmann",
    "müller": "mueller",
    "mueller": "mueller",
    "budni": "budni",
    "galeria": "galeria",
    "mediamarkt": "mediamarkt",
    "saturn": "saturn",
    "smyths toys": "smyths-toys",
    "smyths": "smyths-toys",
    "thalia": "thalia",
    "hugendubel": "hugendubel",
    "toom": "toom",
    "obi": "obi",
    "hornbach": "hornbach",
    "bauhaus": "bauhaus",
    "ikea": "ikea",
  };
  if (map[n]) return map[n];
  // Fallback: simple kebab of the first word
  return n.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

interface MgConfig {
  apiKey: string;
  clientKey: string;
}

let cachedAuth: { keys: MgConfig; loadedAt: number } | null = null;
const AUTH_TTL_MS = 6 * 60 * 60_000; // 6h

async function getAuthKeys(): Promise<MgConfig> {
  if (cachedAuth && Date.now() - cachedAuth.loadedAt < AUTH_TTL_MS) {
    return cachedAuth.keys;
  }
  const log = logger.child({ adapter: "marktguru" });
  const res = await axios.get<string>(HOMEPAGE, {
    timeout: TIMEOUT_MS,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    responseType: "text",
  });
  const match = res.data.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  const rawJson = match?.[1];
  if (!rawJson) throw new Error("marktguru: no config JSON script tag in homepage");
  let parsed: { config?: { apiKey?: string; clientKey?: string } };
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`marktguru: config JSON parse failed: ${(err as Error).message}`);
  }
  const apiKey = parsed.config?.apiKey;
  const clientKey = parsed.config?.clientKey;
  if (!apiKey || !clientKey) {
    throw new Error("marktguru: apiKey/clientKey missing in config");
  }
  cachedAuth = { keys: { apiKey, clientKey }, loadedAt: Date.now() };
  log.info({ apiKeyLen: apiKey.length }, "marktguru auth keys refreshed");
  return cachedAuth.keys;
}

interface MgSearchResponse {
  totalResults: number;
  results: Array<{
    type: string;
    data: {
      id: number;
      description?: string;
      price?: number;
      oldPrice?: number | null;
      referencePrice?: number | null;
      validityDates?: Array<{ from: string; to: string }>;
      advertisers?: Array<{ id: string; name: string }>;
      product?: { id: number; name: string; description?: string };
      brand?: { id: number; name: string };
      categories?: Array<{ id: number; name: string }>;
      images?: { count: number };
      externalUrl?: string;
    };
  }>;
}

async function searchOne(query: string, postalCode: string): Promise<OfflineRawDeal[]> {
  const log = logger.child({ adapter: "marktguru", query, postalCode });
  const auth = await getAuthKeys();
  const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&zipCode=${encodeURIComponent(postalCode)}&limit=100`;
  const res = await axios.get<MgSearchResponse>(url, {
    timeout: TIMEOUT_MS,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "x-apikey": auth.apiKey,
      "x-clientkey": auth.clientKey,
    },
  });
  const total = res.data.totalResults ?? 0;
  const results = (res.data.results ?? []).filter((r) => r.type === "offers" && r.data);
  log.debug({ total, returned: results.length }, "marktguru search completed");

  const deals: OfflineRawDeal[] = [];
  for (const r of results) {
    const d = r.data;
    const adv = d.advertisers?.[0];
    if (!adv) continue;
    const validity = d.validityDates?.[0];
    if (!validity?.from || !validity?.to) continue;
    const title = d.product?.name?.trim();
    if (!title) continue;
    deals.push({
      sourceDealId: String(d.id),
      retailerId: normalizeRetailer(adv.name),
      title,
      description: d.description && d.description !== "Details im Prospekt" ? d.description : undefined,
      brand: d.brand?.name,
      imageUrl: (d.images?.count ?? 0) > 0 ? CDN_IMAGE(d.id) : undefined,
      category: d.categories?.[0]?.name,
      priceEur: typeof d.price === "number" ? d.price : undefined,
      originalPriceEur:
        typeof d.oldPrice === "number" && d.oldPrice > 0 ? d.oldPrice : undefined,
      validFrom: new Date(validity.from),
      validUntil: new Date(validity.to),
      sourceUrl: d.externalUrl ?? undefined,
      postalCode,
    });
  }
  return deals;
}

export function createMarktguruAdapter(): OfflineAdapter {
  const log = logger.child({ adapter: "marktguru" });

  return {
    source: "marktguru",
    async search(queries, postalCodes) {
      // marktguru's API requires a zipCode — if user supplied none, use Berlin
      // (10178) as a sane DE-wide default; the API still returns offers that
      // are valid for the whole country.
      const effectivePostalCodes = postalCodes.length > 0 ? postalCodes : ["10178"];
      const dedup = new Map<string, OfflineRawDeal>();
      for (const pc of effectivePostalCodes) {
        for (const q of queries) {
          try {
            const batch = await searchOne(q, pc);
            for (const d of batch) {
              // Dedup across multiple (query × postalCode) combinations — same
              // deal could appear for both queries and both ZIPs.
              if (!dedup.has(d.sourceDealId)) dedup.set(d.sourceDealId, d);
            }
            // Soft rate-limit: 250ms between requests to be polite
            await new Promise((r) => setTimeout(r, 250));
          } catch (error) {
            log.warn({ err: error, query: q, postalCode: pc }, "marktguru search failed");
          }
        }
      }
      return [...dedup.values()];
    },
  };
}
