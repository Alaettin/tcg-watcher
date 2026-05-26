import type { WatchlistProduct } from "../seed/products.js";
import type { RawListing } from "../adapters/ShopAdapter.js";
import { getSetting, SETTING_KEYS } from "../lib/settings.js";

export interface MatchResult {
  listing: RawListing;
  productId: string;
  confidence: number;
}

const STOP_WORDS = new Set(["und", "and", "the", "der", "die", "das", "ein", "eine", "de", "for", "von"]);

// Fallback / initial seed values. The runtime list lives in the `Setting` table
// under key `SETTING_KEYS.GLOBAL_NEGATIVE_TERMS` and is editable via the UI.
// Generic terms that catch obviously non-TCG products (books, calendars,
// history toys) at retailers like Thalia/Müller that mix Pokémon-branded
// merchandise with the actual sealed TCG products we care about. Old set-name
// entries were removed when SetList took over — those need to MATCH now, not
// be filtered out.
export const DEFAULT_GLOBAL_NEGATIVE_TERMS = [
  "Kalender",
  "Broschurkalender",
  "Buch",
  "eBook",
  "Hörbuch",
  "Roman",
  "Comic",
  "Day-To-Day",
  "Day to Day",
  "Quiz",
  "Geschichte",
  "Krieg",
];

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function matchesNegative(title: string, negatives: string[]): boolean {
  const lower = title.toLowerCase();
  return negatives.some((n) => lower.includes(n.toLowerCase()));
}

const MIN_CONFIDENCE = 0.4;

export async function matchListings(
  listings: RawListing[],
  products: WatchlistProduct[],
): Promise<MatchResult[]> {
  const globalNegatives = await getSetting<string[]>(
    SETTING_KEYS.GLOBAL_NEGATIVE_TERMS,
    DEFAULT_GLOBAL_NEGATIVE_TERMS,
  );
  const results: MatchResult[] = [];

  const productProfiles = products.map((p) => ({
    product: p,
    termTokens: p.searchTerms.map((t) => new Set(tokenize(t))),
  }));

  for (const listing of listings) {
    if (!listing.title) continue;
    if (!/pok[eé]mon|pokémon/i.test(listing.title)) continue;
    if (matchesNegative(listing.title, globalNegatives)) continue;
    const listingTokens = new Set(tokenize(listing.title));
    if (listingTokens.size === 0) continue;

    let best: { productId: string; confidence: number } | null = null;

    for (const { product, termTokens } of productProfiles) {
      if (matchesNegative(listing.title, product.negativeTerms)) continue;
      if (product.ean && listing.title.includes(product.ean)) {
        best = { productId: product.id, confidence: 1 };
        break;
      }
      for (const termSet of termTokens) {
        const score = jaccard(listingTokens, termSet);
        if (score > (best?.confidence ?? 0)) {
          best = { productId: product.id, confidence: score };
        }
      }
    }

    if (best && best.confidence >= MIN_CONFIDENCE) {
      results.push({ listing, productId: best.productId, confidence: best.confidence });
    }
  }

  return results;
}
