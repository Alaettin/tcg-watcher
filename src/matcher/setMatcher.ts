import { prisma } from "../lib/prisma.js";
import { getSetting, getFamilyDefaults, SETTING_KEYS } from "../lib/settings.js";
import { familyOf } from "../scheduler/adapterFamily.js";
import { DEFAULT_GLOBAL_NEGATIVE_TERMS } from "./productMatcher.js";
import type { RawListing } from "../adapters/ShopAdapter.js";

export interface SetMatchResult {
  listing: RawListing;
  setId: string;
  variantId: string | null;
  variantKind: string | null;
  confidence: number;
}

export interface ActiveSet {
  id: string;
  name: string;
  searchTerms: string[];
  negativeTerms: string[];
  variants: Array<{
    id: string;
    kind: string;
    displayName: string;
    uvpEur: number | null;
    uvpToleranceEur: number;
    ean: string | null;
  }>;
}

const STOP_WORDS = new Set([
  "und", "and", "the", "der", "die", "das", "ein", "eine", "de", "for", "von",
]);

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
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Containment / Overlap coefficient: 1.0 wenn ALLE Tokens von
// searchTermTokens in listingTokens sind, sonst 0. Notwendig weil Jaccard
// "kurzer Begriff in langem Titel" bestraft — z.B. SearchTerm "30th
// Anniversary" (2 Tokens) im Title "Pokemon Trading Card Game 30th
// Anniversary First Partner Display" (10 Tokens) ergibt Jaccard 2/10=0.2,
// obwohl der Begriff vollständig drin ist. Containment 1.0 trifft hier.
// Bewusst all-or-nothing damit kein Score-Mid-Range entsteht. Single-Token
// SearchTerms werden ausgeschlossen — "pokemon" allein würde sonst jedes
// Pokemon-Listing matchen.
function containment(searchTermTokens: Set<string>, listingTokens: Set<string>): number {
  if (searchTermTokens.size < 2) return 0;
  for (const t of searchTermTokens) {
    if (!listingTokens.has(t)) return 0;
  }
  return 1.0;
}

function matchesNegative(title: string, negatives: string[]): boolean {
  const lower = title.toLowerCase();
  return negatives.some((n) => lower.includes(n.toLowerCase()));
}

// Lookup: keyword in listing-title → variant-kind. First match wins, longer keywords first.
const KIND_KEYWORDS: Array<{ pattern: RegExp; kind: string }> = [
  { pattern: /\b(elite trainer|top trainer|trainer.?box|etb|ttb)\b/i, kind: "etb" },
  { pattern: /\b(ultra.?premium|premium.?kollektion|premium.?collection|premium.?deck|special.?collection)\b/i, kind: "premium-collection" },
  { pattern: /\b(booster.?bundle|booster.?display.*36|36.?booster.?display|display.?36|36er.?display)\b/i, kind: "display" },
  { pattern: /\b(display|booster.?box)\b/i, kind: "display" },
  { pattern: /\b(3.?pack.?blister|blister)\b/i, kind: "blister" },
  { pattern: /\b(mini.?tin|tin.?box|tin\b)\b/i, kind: "tin" },
  { pattern: /\b(booster.?bundle|bundle.*6.?booster)\b/i, kind: "bundle" },
  { pattern: /\beinzelbooster|booster.?pack\b/i, kind: "booster" },
  { pattern: /\bkollektion|collection\b/i, kind: "collection" },
];

function detectKind(title: string): string | null {
  for (const { pattern, kind } of KIND_KEYWORDS) {
    if (pattern.test(title)) return kind;
  }
  return null;
}

const MIN_CONFIDENCE = 0.4;

// Per-shop cache: resolved set list TTL'd for 60s. Avoids hitting the DB
// for every poll while still picking up list-membership changes within a
// minute (or instantly via invalidateSetsForShopCache after a write).
const SETS_CACHE_TTL_MS = 60_000;
const setsForShopCache = new Map<string, { loadedAt: number; sets: ActiveSet[] }>();

export function invalidateSetsForShopCache(shopId?: string): void {
  if (shopId) {
    setsForShopCache.delete(shopId);
  } else {
    setsForShopCache.clear();
  }
}

function toActiveSet(s: {
  id: string;
  name: string;
  searchTerms: string[];
  negativeTerms: string[];
  variants: Array<{
    id: string;
    kind: string;
    displayName: string;
    uvpEur: number | null;
    uvpToleranceEur: number;
    ean: string | null;
  }>;
}): ActiveSet {
  return {
    id: s.id,
    name: s.name,
    searchTerms: s.searchTerms,
    negativeTerms: s.negativeTerms,
    variants: s.variants.map((v) => ({
      id: v.id,
      kind: v.kind,
      displayName: v.displayName,
      uvpEur: v.uvpEur,
      uvpToleranceEur: v.uvpToleranceEur,
      ean: v.ean,
    })),
  };
}

export interface ShopForSetResolution {
  id: string;
  adapterType: string;
  setListId: string | null;
}

export async function getSetsForShop(shop: ShopForSetResolution): Promise<ActiveSet[]> {
  const cached = setsForShopCache.get(shop.id);
  if (cached && Date.now() - cached.loadedAt < SETS_CACHE_TTL_MS) {
    return cached.sets;
  }

  const family = familyOf(shop);
  const familyDefaults = await getFamilyDefaults();
  const effectiveListId =
    shop.setListId ?? (family === "fast" ? familyDefaults.fast : familyDefaults.slow);

  if (!effectiveListId) {
    setsForShopCache.set(shop.id, { loadedAt: Date.now(), sets: [] });
    return [];
  }

  const list = await prisma.setList.findUnique({
    where: { id: effectiveListId },
    include: { items: { include: { set: { include: { variants: true } } } } },
  });

  const sets = (list?.items ?? []).map((i) => toActiveSet(i.set));
  setsForShopCache.set(shop.id, { loadedAt: Date.now(), sets });
  return sets;
}

export async function matchListingsToSets(
  listings: RawListing[],
  activeSets: ActiveSet[],
): Promise<SetMatchResult[]> {
  if (activeSets.length === 0) return [];

  const globalNegatives = await getSetting<string[]>(
    SETTING_KEYS.GLOBAL_NEGATIVE_TERMS,
    DEFAULT_GLOBAL_NEGATIVE_TERMS,
  );

  const setProfiles = activeSets.map((s) => ({
    set: s,
    termTokens: s.searchTerms.map((t) => new Set(tokenize(t))),
  }));

  const results: SetMatchResult[] = [];

  for (const listing of listings) {
    if (!listing.title) continue;
    if (!/pok[eé]mon|pokémon/i.test(listing.title)) continue;
    if (matchesNegative(listing.title, globalNegatives)) continue;
    const listingTokens = new Set(tokenize(listing.title));
    if (listingTokens.size === 0) continue;

    let best: { setId: string; confidence: number } | null = null;

    for (const { set, termTokens } of setProfiles) {
      if (matchesNegative(listing.title, set.negativeTerms)) continue;
      for (const termSet of termTokens) {
        const jaccardScore = jaccard(listingTokens, termSet);
        const containmentScore = containment(termSet, listingTokens);
        const score = Math.max(jaccardScore, containmentScore);
        if (score > (best?.confidence ?? 0)) {
          best = { setId: set.id, confidence: score };
        }
      }
    }

    if (!best || best.confidence < MIN_CONFIDENCE) continue;

    const matchedSet = activeSets.find((s) => s.id === best!.setId)!;
    const detectedKind = detectKind(listing.title);
    const variant = detectedKind
      ? matchedSet.variants.find((v) => v.kind === detectedKind) ?? null
      : null;

    results.push({
      listing,
      setId: matchedSet.id,
      variantId: variant?.id ?? null,
      variantKind: variant?.kind ?? detectedKind ?? null,
      confidence: best.confidence,
    });
  }

  return results;
}
