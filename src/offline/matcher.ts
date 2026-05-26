import type { OfflineRawDeal } from "./OfflineAdapter.js";

// Bewusst simpler als der setMatcher — kein Set-Filter, kein Jaccard. Wir
// wollen ALLE Pokemon-Treffer ranlassen (TCG + Merchandise wie Plüsch,
// Klamotten, Schreibwaren) und nur über die Negative-Liste den Müll
// (Hörspiel, Kalender, Roman) abklemmen.
export function isPokemonHit(deal: OfflineRawDeal, negativeTerms: string[]): boolean {
  const haystack = [deal.title, deal.brand ?? "", deal.description ?? "", deal.category ?? ""]
    .join(" ")
    .toLowerCase();
  if (!/pok[eé]mon|pokémon/.test(haystack)) return false;
  return !negativeTerms.some((n) => haystack.includes(n.toLowerCase()));
}
